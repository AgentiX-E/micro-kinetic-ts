/**
 * Tests for the held-out validator, its two criteria, and the prior floor.
 *
 * Every arm here is a decision with a correct answer, so the assertions are on VALUES rather than on shapes: a
 * fixture whose numbers were chosen so each router's optimum — and each cross-validation fold — is checkable by
 * hand. The two fixtures that matter most are `bitesFixture` and `cleanFixture`: the first is built so that the
 * highest-accuracy router sinks one unit and the zero-regression rule has to give the whole gain up, the second so
 * that the rule costs nothing. Both answers are stated as exact rationals, so an implementation that drifts by one
 * case fails rather than looks fine.
 *
 * @module benchmarks/__tests__/router-validation
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
  formatSuiteValidation,
  isEntryPoint,
  main,
  reportFile,
  VALIDATION_CONSTRAINTS,
  VALIDATION_SIGNALS,
} from '../src/validate-routing-frontier.js';

import type { RoutingCase } from '../src/router-validation.js';
import {
  accuracy,
  alwaysEngine,
  cellTallies,
  crossValidateRouter,
  disjoint,
  engineCorrect,
  engineMargin,
  FIT_CONSTRAINTS,
  fitThreshold,
  folds,
  modalTruth,
  priorFloor,
  prismCorrect,
  prismMargin,
  regressedCells,
  regressionKey,
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

/**
 * One case whose ONLY routable signal is its margin, on one named regression unit.
 *
 * The margin is applied to BOTH engines, so `engine-margin` and `prism-margin` carry the same information and a
 * fixture can put more than one signal on the deployable frontier — which is what makes the report's
 * "more than one arm cleared the baseline" path reachable.
 */
const unitCase = (
  id: string,
  cell: string,
  faultType: string,
  margin: number,
  engineWins: boolean,
): RoutingCase =>
  c({
    caseId: id,
    cell,
    faultType,
    // `engineWins` decides which engine is right; PRISM is always the other one, so every case is routable.
    truth: engineWins ? 'engine-pick' : 'prism-pick',
    engineTop1: 'engine-pick',
    prismTop1: 'prism-pick',
    engineTop1Score: margin,
    engineTop2Score: 0,
    prismTop1Score: margin,
    prismTop2Score: 0,
  });

/** `n` copies of one case shape, so a unit can have a size without listing every copy. */
function repeat(
  n: number,
  cell: string,
  faultType: string,
  margin: number,
  engineWins: boolean,
  id: string,
): RoutingCase[] {
  return Array.from({ length: n }, (_, i) =>
    unitCase(`${id}-${i}`, cell, faultType, margin, engineWins),
  );
}

/**
 * Four units over two systems and two fault types, twelve cases.
 *
 * | unit          | n | margin | engine right? | routed to PRISM when threshold > margin |
 * | ------------- | - | ------ | ------------- | --------------------------------------- |
 * | `S:1/cpu`     | 4 | 0.1    | no            | wins 4                                  |
 * | `S:1/delay`   | 2 | 0.3    | yes           | LOSES 2 — the unit the rule protects    |
 * | `S:2/cpu`     | 4 | 0.5    | no            | wins 4                                  |
 * | `S:2/delay`   | 2 | 0.7    | yes           | untouched                               |
 *
 * Every threshold that reaches the two winning units also reaches `S:1/delay`, whose margin is the smallest of
 * the three it is sandwiched between: that is what makes the constraint BIND. A and C share a fault type while A
 * and B share a system, so the unit is pinned as the PAIR and not either half of it.
 */
function bitesFixture(): RoutingCase[] {
  return [
    ...repeat(4, 'S:1', 'cpu', 0.1, false, 'a'),
    ...repeat(2, 'S:1', 'delay', 0.3, true, 'b'),
    ...repeat(4, 'S:2', 'cpu', 0.5, false, 'c'),
    ...repeat(2, 'S:2', 'delay', 0.7, true, 'd'),
  ];
}

/** The same shape with the losing unit's margin ABOVE every winning one, so no threshold can reach both. */
function cleanFixture(): RoutingCase[] {
  return [
    ...repeat(2, 'S:1', 'cpu', 0.2, false, 'a'),
    ...repeat(2, 'S:1', 'delay', 0.95, true, 'b'),
  ];
}

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

  it('names exactly two criteria, so a fit can never be reported without the one it used', () => {
    expect(Object.keys(FIT_CONSTRAINTS).sort()).toEqual(['max-accuracy', 'zero-regression']);
    // The two constraints are distinct names for distinct rules; sharing one would make the reports identical.
    expect(VALIDATION_CONSTRAINTS).toEqual(['max-accuracy', 'zero-regression']);
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
    expect(accuracy([low, high], alwaysEngine('engine-margin'))).toBeCloseTo(0.5, 12);
    expect(accuracy([low, high], router)).toBeCloseTo(1, 12);
    // An empty population is 0 rather than NaN: a fold with nothing in it contributes nothing.
    expect(accuracy([], router)).toBe(0);
  });

  it('builds the always-engine arm as the one threshold below every observation', () => {
    const cases = bitesFixture();
    const arm = alwaysEngine('engine-margin');
    expect(arm.threshold).toBe(Number.NEGATIVE_INFINITY);
    // The arm leaves every case with the engine, so its accuracy IS the baseline the frontier is read against.
    expect(accuracy(cases, arm)).toBeCloseTo(4 / 12, 12);
  });
});

describe('router-validation — the regression unit', () => {
  it('keys a unit as <cell>/<fault-type>, the string the probe writes into its own regressingCells', () => {
    // The convention has TWO implementations, and both cannot be reachable from one test: the benchmarks project
    // does not depend on `@agentix-e/micro-kinetic` (the vitest alias that resolves it is test-only, and is absent
    // from `benchmarks/tsconfig.json`), so an import here would be an undeclared dependency that fails `tsc`.
    // The convention is therefore pinned by LITERAL on each side: `routing-probe.test.ts` asserts the probe's
    // `regressionCellKey` produces this exact string, and this asserts the validator's `regressionKey` does — so
    // re-keying one side alone fails its own test rather than silently splitting the unit in two.
    const sample = [
      c({ truth: 'a', cell: 'RE3:TrainTicket', faultType: 'f1' }),
      c({ truth: 'a', cell: 'RE2:OnlineBoutique', faultType: 'socket' }),
      c({ truth: 'a', cell: 'RE1:SockShop', faultType: 'delay' }),
    ];
    for (const one of sample) {
      expect(regressionKey(one)).toBe(`${one.cell}/${one.faultType}`);
    }
    // The four units of the fixture, spelled out, so the pin is not only on the expression above.
    const keys = new Set(bitesFixture().map(regressionKey));
    expect([...keys].sort()).toEqual(['S:1/cpu', 'S:1/delay', 'S:2/cpu', 'S:2/delay']);
  });

  it('tallies every unit over exactly the cases it was given, and is empty for an empty population', () => {
    const cases = bitesFixture();
    const tallies = cellTallies(cases, alwaysEngine('engine-margin'));
    expect(tallies.size).toBe(4);
    // The engine wins on the two `delay` units and loses on the two `cpu` ones, so the tallies are not uniform
    // and a tallies implementation that ignored `truth` would fail here.
    expect(tallies.get('S:1/cpu')).toEqual({ correct: 0, total: 4 });
    expect(tallies.get('S:1/delay')).toEqual({ correct: 2, total: 2 });
    expect(tallies.get('S:2/cpu')).toEqual({ correct: 0, total: 4 });
    expect(tallies.get('S:2/delay')).toEqual({ correct: 2, total: 2 });
    expect(cellTallies([], alwaysEngine('engine-margin')).size).toBe(0);
  });

  it('names exactly the unit a router sank, and nothing when the router only ties', () => {
    const cases = bitesFixture();
    // Threshold 0.7 reaches every winning unit AND `S:1/delay`, whose engine was right on both cases.
    expect(regressedCells(cases, { signal: 'engine-margin', threshold: 0.7 })).toEqual([
      'S:1/delay',
    ]);
    // The mean rises on this router while a unit falls — which is the whole reason the criterion exists.
    const arm = accuracy(cases, alwaysEngine('engine-margin'));
    expect(accuracy(cases, { signal: 'engine-margin', threshold: 0.7 })).toBeGreaterThan(arm);
    // A threshold that reaches nothing is a tie on every unit, and a tie is NOT a regression.
    expect(regressedCells(cases, { signal: 'engine-margin', threshold: 0.1 })).toEqual([]);
    expect(regressedCells(cases, alwaysEngine('engine-margin'))).toEqual([]);
    expect(regressedCells([], alwaysEngine('engine-margin'))).toEqual([]);
  });

  it('cannot be offset: a unit that gains does not excuse a unit that loses', () => {
    const cases = bitesFixture();
    const router = { signal: 'engine-margin' as const, threshold: 0.7 };
    // Two units improve and one is untouched, yet the count is one — a regression is a per-unit fact.
    const regressed = regressedCells(cases, router);
    expect(regressed).toHaveLength(1);
    expect(regressed).not.toContain('S:1/cpu');
    expect(regressed).not.toContain('S:2/cpu');
  });
});

describe('router-validation — fitting a threshold under a criterion', () => {
  it('finds the exact optimum under max-accuracy, because the scan is over the observed values', () => {
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
    const router = fitThreshold(cases, 'engine-margin', 'max-accuracy');
    expect(router.signal).toBe('engine-margin');
    // The optimum sits at 0.9 — the largest observed value — and ROUTES ALL THREE to PRISM, because 0.9 is not
    // strictly below its own threshold while 0.1 and 0.2 are: the third case stays with the engine (`truth` 'e')
    // and is correct there, so the optimum is a perfect 3 of 3 rather than the 2 of 3 the first draft expected.
    expect(router.threshold).toBeCloseTo(0.9, 12);
    expect(accuracy(cases, router)).toBeCloseTo(1, 12);
    // And the arm below the smallest observation is the always-engine one, worth a third.
    expect(accuracy(cases, { signal: 'engine-margin', threshold: 0.1 })).toBeCloseTo(1 / 3, 12);
  });

  it('REFUSES under zero-regression the gain that sinks a unit, and reports the one it can keep', () => {
    const cases = bitesFixture();
    // Hand-computed: the unconstrained optimum is 10/12 at threshold 0.7, and it sinks `S:1/delay`.
    const loose = fitThreshold(cases, 'engine-margin', 'max-accuracy');
    expect(loose.threshold).toBeCloseTo(0.7, 12);
    expect(accuracy(cases, loose)).toBeCloseTo(10 / 12, 12);
    expect(regressedCells(cases, loose)).toEqual(['S:1/delay']);
    // The same scan under the rule keeps `S:1/delay` and loses the other winning unit at 0.5, settling at 0.3
    // for 8/12 — the whole of `S:2/cpu` is given up because reaching it would also reach the losing unit.
    const strict = fitThreshold(cases, 'engine-margin', 'zero-regression');
    expect(strict.threshold).toBeCloseTo(0.3, 12);
    expect(accuracy(cases, strict)).toBeCloseTo(8 / 12, 12);
    expect(regressedCells(cases, strict)).toEqual([]);
    // So the constraint is not decoration: it costs 2 of 12 cases on this population.
    expect(accuracy(cases, strict)).toBeLessThan(accuracy(cases, loose));
  });

  it('costs nothing when the highest-accuracy router already regresses no unit', () => {
    const cases = cleanFixture();
    const loose = fitThreshold(cases, 'engine-margin', 'max-accuracy');
    const strict = fitThreshold(cases, 'engine-margin', 'zero-regression');
    // `S:1/delay` sits above every winning margin, so no threshold can reach both: the gain is clean.
    expect(loose).toEqual(strict);
    expect(accuracy(cases, strict)).toBeCloseTo(1, 12);
    expect(regressedCells(cases, strict)).toEqual([]);
  });

  it('returns the always-engine arm when nothing admissible beats doing nothing', () => {
    const cases = [
      c({ truth: 'e', engineTop1: 'e', prismTop1: 'p', engineTop1Score: 1, engineTop2Score: 0 }),
      c({ truth: 'e2', engineTop1: 'e2', prismTop1: 'p', engineTop1Score: 2, engineTop2Score: 0 }),
    ];
    for (const constraint of VALIDATION_CONSTRAINTS) {
      expect(fitThreshold(cases, 'engine-margin', constraint)).toEqual({
        signal: 'engine-margin',
        threshold: Number.NEGATIVE_INFINITY,
      });
    }
  });

  it('breaks ties toward the SMALLER threshold, so two fits on one fold agree', () => {
    // Every case is routable and every threshold that routes any of them scores the same ⇒ the tie must resolve.
    const cases = [
      c({ truth: 'p', engineTop1: 'e', prismTop1: 'p', engineTop1Score: 5, engineTop2Score: 0 }),
      c({ truth: 'p', engineTop1: 'e', prismTop1: 'p', engineTop1Score: 5, engineTop2Score: 0 }),
    ];
    for (const constraint of VALIDATION_CONSTRAINTS) {
      const a = fitThreshold(cases, 'engine-margin', constraint);
      const b = fitThreshold(cases, 'engine-margin', constraint);
      expect(a).toEqual(b);
      expect(a.threshold).toBe(Number.NEGATIVE_INFINITY);
    }
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
    const cv = crossValidateRouter(cases, 'engine-margin', 5, 'max-accuracy');
    expect(cv.folds).toBe(5);
    expect(cv.constraint).toBe('max-accuracy');
    expect(cv.perFold).toHaveLength(5);
    expect(cv.thresholds).toHaveLength(5);
    expect(cv.perFoldRegressed).toHaveLength(5);
    expect(cv.baseline).toBeCloseTo(13 / 20, 12);
    // ⚠️ `inSample >= heldOut` is NOT asserted, and the reason is a law this fixture taught the hard way: the
    // k-fold mean is the mean of k accuracies, each from a router fitted on a DIFFERENT train set, so a fold whose
    // cases happen to be easy can score above the whole-set optimum. The in-sample figure is optimistic for a
    // FIXED router chosen on all the data; it is not a ceiling on a fold mean. What is asserted is the algebra:
    expect(cv.fittingAllowance).toBeCloseTo(cv.inSample - cv.heldOut, 12);
    expect(cv.heldOutGain).toBeCloseTo(cv.heldOut - cv.baseline, 12);
    expect(cv.regressedUnitsHeldOut).toBe(cv.perFoldRegressed.reduce((s, x) => s + x, 0));
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

  it('cross-validates under the rule, hand-computed on both criteria', () => {
    // `bitesFixture` folds as `i % 4`, and each train fold carries the same THREE units at the same margins, so
    // every fold picks the same threshold and the four held-out accuracies are data rather than luck:
    //
    //   train: S:1/cpu x3 (0.1, engine-wrong) · S:1/delay x1..2 (0.3, engine-right) · S:2/cpu x3 (0.5, wrong)
    //          · S:2/delay x1..2 (0.7, engine-right)
    //   max-accuracy     -> 0.7 : 8/9 on train, 2/3 or 1 on the held-out fold  (S:1/delay sunk everywhere)
    //   zero-regression  -> 0.3 : 6/9 on train, 2/3 on every held-out fold      (S:1/delay kept)
    const cases = bitesFixture();
    const loose = crossValidateRouter(cases, 'engine-margin', 4, 'max-accuracy');
    const strict = crossValidateRouter(cases, 'engine-margin', 4, 'zero-regression');

    expect(loose.constraint).toBe('max-accuracy');
    expect(strict.constraint).toBe('zero-regression');
    expect(loose.baseline).toBeCloseTo(4 / 12, 12);
    expect(strict.baseline).toBeCloseTo(4 / 12, 12);

    expect(loose.thresholds.map((t) => Number(t.toFixed(6)))).toEqual([0.7, 0.7, 0.7, 0.7]);
    expect(strict.thresholds.map((t) => Number(t.toFixed(6)))).toEqual([0.3, 0.3, 0.3, 0.3]);
    expect(loose.perFold.map((x) => Number(x.toFixed(6)))).toEqual(
      [2 / 3, 2 / 3, 1, 1].map((x) => Number(x.toFixed(6))),
    );
    expect(strict.perFold.map((x) => Number(x.toFixed(6)))).toEqual(
      [2 / 3, 2 / 3, 2 / 3, 2 / 3].map((x) => Number(x.toFixed(6))),
    );

    expect(loose.inSample).toBeCloseTo(10 / 12, 12);
    expect(strict.inSample).toBeCloseTo(8 / 12, 12);
    // The feasible set of the rule is a SUBSET of the unconstrained one, both measured on the same full set, so
    // this ordering is a theorem rather than an observation — unlike `inSample >= heldOut`, which is not.
    expect(strict.inSample).toBeLessThanOrEqual(loose.inSample);

    // ⚠️ The rule is fitted on the TRAIN folds and its promise is not inherited by the fold it then scores: the
    // unconstrained arm sinks one unit in two of the four folds, and the constrained arm sinks none on this
    // fixture. Both numbers are printed because a nonzero count is the honest read of how far the guarantee
    // travels, and this fixture is the easy case rather than the general one.
    expect(loose.regressedUnitsHeldOut).toBe(2);
    expect(loose.perFoldRegressed).toEqual([1, 1, 0, 0]);
    expect(strict.regressedUnitsHeldOut).toBe(0);
    expect(strict.perFoldRegressed).toEqual([0, 0, 0, 0]);
    expect(loose.regressedUnitsHeldOut).toBe(loose.perFoldRegressed.reduce((s, x) => s + x, 0));
  });

  it('falls back to the baseline when a fold leaves nothing to fit on', () => {
    // k = n leaves each train fold with n-1 cases; k > n is what empties one, and that arm must not crash.
    const cases = [c({ truth: 'a' }), c({ truth: 'a' })];
    for (const constraint of VALIDATION_CONSTRAINTS) {
      const cv = crossValidateRouter(cases, 'engine-margin', 4, constraint);
      expect(cv.perFold).toHaveLength(4);
      // Two of the four folds are empty; their train set is the whole population, so they score the full-set fit.
      expect(cv.thresholds.every((t) => Number.isFinite(t) || t === Number.NEGATIVE_INFINITY)).toBe(
        true,
      );
      expect(Number.isFinite(cv.heldOut)).toBe(true);
      // An empty TEST fold cannot regress anything, and an empty train fold keeps the baseline — so the count of
      // (fold, unit) pairs is zero here on both criteria.
      expect(cv.regressedUnitsHeldOut).toBe(0);
    }
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
    const cv = crossValidateRouter(cases, 'engine-margin', 3, 'max-accuracy');
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

  it('prints the floor, the baseline, BOTH criteria per signal, and the unit of the regression count', () => {
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
    expect(text).toContain('baseline (always-engine) = ');
    // Every signal appears once per criterion, so the table is 3 x 2 rows and not 3.
    for (const signal of VALIDATION_SIGNALS) expect(text).toContain(signal);
    for (const constraint of VALIDATION_CONSTRAINTS) expect(text).toContain(constraint);
    expect(text.match(/max-accuracy/g)).toHaveLength(VALIDATION_SIGNALS.length);
    expect(text.match(/zero-regression/g)!.length).toBeGreaterThanOrEqual(
      VALIDATION_SIGNALS.length,
    );
    expect(text).toContain('held gain');
    expect(text).toContain('regr');
    // The unit must ship WITH the number: a bare count reads as a percentage of cells, which it is not.
    expect(text).toContain('pairs scored below the always-engine baseline ON THAT FOLD');
    expect(text).toContain('so this counts PAIRS and not distinct cells');
    // The caveat about the sign ships WITH the number, because a reader who takes the difference as positive
    // would read a fold mean as bounded by a whole-set optimum, which it is not.
    expect(text).toContain('Its SIGN is not guaranteed');
    // And the header states the fold count that was actually used, so a reader cannot mistake a 2-fold
    // estimate for the default 5-fold one.
    expect(text).toContain('"held out" fits the threshold on 1 folds and scores the 2th');
  });

  it('closes with the DEPLOYABLE read, and says so when no arm clears the baseline', () => {
    // A population where the engine is already perfect: no threshold can beat it, so no arm is deployable.
    const perfect = [c({ caseId: 'a', truth: 'a' }), c({ caseId: 'b', truth: 'a' })];
    const text = formatSuiteValidation('perfect', perfect, 2).join('\n');
    expect(text).toContain('DEPLOYABLE READ: no zero-regression arm scored above the baseline');
    // The bites fixture has one deployable arm, and the line has to name it and quote its held-out gain.
    const deployable = formatSuiteValidation('bites', bitesFixture(), 4).join('\n');
    expect(deployable).toContain('DEPLOYABLE READ: the best zero-regression arm is');
    expect(deployable).toContain('held out. The larger figures above are unconstrained optima.');
    expect(deployable).not.toContain('no zero-regression arm scored above the baseline');
  });

  it('prints a router that HURTS out of sample as a signed loss, because the sign is the result', () => {
    // Two units and two margins, arranged so each fold's train is the OTHER unit and learns the wrong thing: the
    // fold holding only the engine-right `S:2/delay` cases fits "route every low margin to PRISM", and the fold it
    // is then scored on holds only the engine-WRONG `S:1/cpu` cases at the same low margin — so it routes them to
    // the engine and loses both. The held-out gain is NEGATIVE, which is the state a report must not print as a
    // bare unsigned number.
    const disjoint = [
      unitCase('0', 'S:1', 'cpu', 0.1, false),
      unitCase('1', 'S:2', 'delay', 0.1, true),
      unitCase('2', 'S:1', 'cpu', 0.9, false),
      unitCase('3', 'S:2', 'delay', 0.9, true),
    ];
    // Hand-computed: fold `{0,2}` scores 0/2 and fold `{1,3}` scores 1/2, against a baseline of 2/4, and no
    // threshold improves on the whole set at all — so the in-sample optimum IS the baseline at 50.00% and the
    // held-out estimate is 25.00%, a loss of 25.00pp.
    const text = formatSuiteValidation('disjoint', disjoint, 2).join('\n');
    expect(text).toContain('-25.00pp');
    expect(text).toMatch(/engine-margin\s+max-accuracy\s+50\.00%\s+25\.00%/);
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

  it('runs its CLI only when the module IS the entry point, asserted without spawning one', () => {
    // The guard is what keeps this file importable by the tests above, so its own condition is the one statement
    // that no import reaches. Hoisting it into a predicate is what makes all three of its outcomes checkable.
    const self = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../src/validate-routing-frontier.ts',
    );
    const selfUrl = pathToFileURL(self).href;
    expect(isEntryPoint(self, selfUrl)).toBe(true);
    expect(isEntryPoint(self, 'file:///somewhere/else.js')).toBe(false);
    expect(isEntryPoint(undefined, selfUrl)).toBe(false);
    // Under vitest the running process was started on vitest's own binary, so the guard is FALSE for the module
    // under test — which is exactly the property that lets this suite import it at all.
    expect(isEntryPoint(process.argv[1], import.meta.url)).toBe(false);
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
