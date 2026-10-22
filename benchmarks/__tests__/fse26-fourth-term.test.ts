/**
 * The fourth term: the failed-edge DIRECTION, measured as a term against the run-reproducing baseline.
 *
 * The measured table lives in the CLI (`--discriminator`); these tests hold the properties it rests on. The important
 * one is the zero arm's identity: at weight 0 the direction contributes nothing, so that arm IS the engine's blend —
 * which is what makes every net in the table a difference from the engine rather than from another reconstruction.
 *
 * @module benchmarks/__tests__/fse26-fourth-term
 */

import { describe, expect, it } from 'vitest';

import type { DiagnosedCase, DiagnosedService } from '../src/fse26-diagnose-analyze.js';
import { foldOf } from '../src/fse26-discriminator.js';
import {
  DIRECTION_ARMS,
  directionReport,
  faultTypeSplit,
  formatDirectionReport,
  formatHoldoutReport,
  HOLDOUT_BAR,
  holdoutDirectionReport,
} from '../src/fse26-fourth-term.js';
import type { TermOracleOptions } from '../src/fse26-term-oracle.js';
import { latencySlopes, rankCase } from '../src/fse26-term-oracle.js';

const OPTS: TermOracleOptions = {
  logWeight: 1,
  latWeight: 0,
  latFloor: 10.3,
  dominance: 0.5,
  dominanceGrid: [],
  poolWeight: 0,
  temporalWeight: 0,
  onsetShape: 'earliness',
};

function svc(o: Partial<DiagnosedService> & Pick<DiagnosedService, 'serviceId'>): DiagnosedService {
  return {
    isGroundTruth: false,
    predictedRank: undefined,
    selfAnomaly: 0,
    logScore: 0,
    failedEdgeScore: undefined,
    failedEdgeRecords: undefined,
    latRise: undefined,
    latEdges: undefined,
    onsetDelayMs: undefined,
    dominantMetric: 'cpu',
    errorCount: 0,
    fatalCount: 0,
    logicExceptionCount: 0,
    httpExceptionCount: 0,
    bothExceptionCount: undefined,
    metricNames: undefined,
    metricOutcomes: undefined,
    decisiveOutcome: undefined,
    ...o,
  };
}

function kase(o: Partial<DiagnosedCase> & Pick<DiagnosedCase, 'services'>): DiagnosedCase {
  return {
    datapack: 'd1',
    faultType: 'cpu',
    groundTruth: [],
    logSignalMode: 'count',
    prediction: [],
    edges: undefined,
    injectTimeMs: undefined,
    fieldDecimals: undefined,
    ...o,
  };
}

/** `symptom` is anomalous and has NO direction; `source` is quiet and is the callee every failed call was made against. */
const services = () => [
  svc({ serviceId: 'symptom', selfAnomaly: Math.exp(1), logScore: 0 }),
  svc({ serviceId: 'source', selfAnomaly: 0, logScore: 0, failedEdgeScore: 1 }),
];

const order = (weight: number): string => {
  const options: TermOracleOptions = { ...OPTS, failedEdgeWeight: weight };
  return rankCase(
    kase({ services: services() }),
    options,
    'recorded',
    latencySlopes(services(), 10.3),
  ).order[0]!;
};

describe('the direction term', () => {
  it('is INERT at weight 0, which is what makes the zero arm the engine’s own blend', () => {
    // Measured first, asserted second: the two orders differ, and the difference is what the term is for.
    expect(order(0)).toBe('symptom');
    expect(order(4)).toBe('source');
  });

  it('flips the winner toward the CALLEE once the weight can overcome the anomaly gap', () => {
    // `symptom` carries metric log1p(e^1) = 1 and `source` carries 3 · 1 = 3, so the direction wins at 3 and not at 0.
    // This is the fault-DIRECTION claim stated as arithmetic: a victim reports the error, the dependency caused it.
    expect(order(0.5)).toBe('symptom');
    expect(order(3)).toBe('source');
  });
});

describe('directionReport', () => {
  it('scores the zero arm as the baseline, with no net and no split', () => {
    const report = directionReport(
      [kase({ services: services(), groundTruth: ['symptom'] })],
      OPTS,
    );
    const zero = report.screens.find((screen) => screen.arm.weight === 0)!;
    expect(zero.correct).toBe(1);
    expect(zero.correct).toBe(zero.baselineCorrect);
    expect(zero.fixed).toEqual([]);
    expect(zero.broken).toEqual([]);
  });

  it('reports a FIX and a BREAK on the same fixture, which is what a trading arm looks like', () => {
    const fixed = directionReport(
      [kase({ datapack: 'f1', services: services(), groundTruth: ['source'] })],
      OPTS,
      [
        { weight: 0, claim: 'off' },
        { weight: 3, claim: 'on' },
      ],
    );
    const arm = fixed.screens[1]!;
    expect(arm.baselineCorrect).toBe(0);
    expect(arm.correct).toBe(1);
    expect(arm.fixed).toEqual(['f1']);
    expect(arm.broken).toEqual([]);

    const broken = directionReport(
      [kase({ datapack: 'b1', services: services(), groundTruth: ['symptom'] })],
      OPTS,
      [
        { weight: 0, claim: 'off' },
        { weight: 3, claim: 'on' },
      ],
    );
    expect(broken.screens[1]!.broken).toEqual(['b1']);
    expect(broken.screens[1]!.fixed).toEqual([]);
  });

  it('gives every arm the SAME baseline, read back from the zero arm rather than recounted', () => {
    const report = directionReport(
      [
        kase({ services: services(), groundTruth: ['symptom'] }),
        kase({ services: services(), groundTruth: ['source'] }),
      ],
      OPTS,
    );
    const baselines = new Set(report.screens.map((screen) => screen.baselineCorrect));
    expect(baselines.size).toBe(1);
    expect([...baselines][0]).toBe(1);
  });

  it('answers 0, not a crash, when the caller passes NO zero arm', () => {
    // The type allows a menu without a baseline — a caller measuring "how bad can a weight be" wants no zero arm —
    // and the alternative to answering 0 is a lookup on `undefined` that would take the whole report down. The net
    // column then reads as the distance from zero, which is why the report prints the arm list it was given.
    const report = directionReport(
      [kase({ services: services(), groundTruth: ['source'] })],
      OPTS,
      [{ weight: 3, claim: 'on' }],
    );
    expect(report.screens[0]!.baselineCorrect).toBe(0);
    expect(report.screens[0]!.correct).toBe(1);
  });

  it('counts a case with a root but NO services as unwinnable, rather than skipping it', () => {
    // The `?? ''` fallbacks on both orderings fire here. A case can name a root and have nothing to rank — its block
    // was truncated, or the engine found no candidate — and skipping it would shrink the population every screen
    // reasons about. It depresses the baseline and every arm equally, which is the honest reading.
    const report = directionReport([kase({ services: [], groundTruth: ['ghost'] })], OPTS, [
      { weight: 0, claim: 'off' },
      { weight: 3, claim: 'on' },
    ]);
    expect(report.screens[0]!.cases).toBe(1);
    expect(report.screens[0]!.correct).toBe(0);
    expect(report.screens[1]!.broken).toEqual([]);
  });

  it('survives a corpus that names no root, without dividing by zero', () => {
    const report = directionReport([kase({ services: services(), groundTruth: [] })], OPTS, [
      { weight: 0, claim: 'off' },
      { weight: 3, claim: 'on' },
    ]);
    expect(report.agreement.cases).toBe(0);
    expect(formatDirectionReport(report)).toContain('0/0');
    expect(formatDirectionReport(report)).not.toContain('NaN');
  });

  it('prints a NEGATIVE net as a negative number, which is the arm that hurts', () => {
    // One break and no fix: the arm loses the only case in the corpus. `net` is −1 and the cell must read `-1`
    // rather than `+-1`, so the sign formatter's other arm is exercised by a real regression.
    const report = directionReport(
      [kase({ services: services(), groundTruth: ['symptom'] })],
      OPTS,
      [
        { weight: 0, claim: 'off' },
        { weight: 3, claim: 'on' },
      ],
    );
    const text = formatDirectionReport(report);
    expect(text).toContain('-1');
    expect(text).toContain('does not help');
  });

  it('discharges law 41 by carrying the baseline’s agreement', () => {
    // The reconstruction names `symptom` at weight 0 — measured in the first test, not assumed — so a recorded
    // `symptom` is what AGREES. Recording `source` here would assert a disagreement and call it a discharge.
    const report = directionReport(
      [kase({ services: services(), groundTruth: ['source'], prediction: ['symptom'] })],
      OPTS,
    );
    expect(report.agreement.cases).toBe(1);
    expect(report.agreement.agreed).toBe(1);
  });
});

describe('formatDirectionReport', () => {
  const report = directionReport(
    [
      kase({
        datapack: 'x',
        services: services(),
        groundTruth: ['source'],
        prediction: ['source'],
      }),
    ],
    OPTS,
    [
      { weight: 0, claim: 'off' },
      { weight: 3, claim: 'on' },
    ],
  );

  it('prints the baseline agreement ABOVE the table, so no net is read without it', () => {
    const text = formatDirectionReport(report);
    expect(text.split('\n')[1]).toContain('baseline agreement');
    expect(text.indexOf('baseline agreement')).toBeLessThan(text.indexOf('weight   claim'));
  });

  it('calls a weight that only gains a candidate and never loses one DOMINATES, and a trading one by its name', () => {
    const dominating = formatDirectionReport(
      directionReport(
        [kase({ datapack: 'd', services: services(), groundTruth: ['source'] })],
        OPTS,
        [
          { weight: 0, claim: 'off' },
          { weight: 3, claim: 'on' },
        ],
      ),
    );
    expect(dominating).toContain('DOMINATES');
    // TWO fixes and ONE break: net +1 with a loss, which is the shape "trades" names. One case each way would net
    // to zero and be reported as "does not help" — a different verdict, and the reason this fixture is lopsided.
    const trading = formatDirectionReport(
      directionReport(
        [
          kase({ datapack: 'd', services: services(), groundTruth: ['source'] }),
          kase({ datapack: 'e', services: services(), groundTruth: ['source'] }),
          kase({ datapack: 'g', services: services(), groundTruth: ['symptom'] }),
        ],
        OPTS,
        [
          { weight: 0, claim: 'off' },
          { weight: 3, claim: 'on' },
        ],
      ),
    );
    expect(trading).toContain('trades, cannot pass');
  });

  it('ships a menu that spans the TURNING POINT, so a maximum can be told from a plateau', () => {
    const weights = DIRECTION_ARMS.map((arm) => arm.weight);
    expect(weights[0]).toBe(0);
    // Strictly increasing and reaching past the measured maximum: an arm at 4 is what makes 3 a maximum.
    expect(weights).toEqual([...weights].sort((a, b) => a - b));
    expect(weights).toContain(3);
    expect(weights).toContain(4);
  });
});

describe('holdoutDirectionReport — the weight chosen on four folds, read on the fifth', () => {
  /** A corpus wide enough to fill five folds: `datapack` drives the fold, so the ids are spread deliberately. */
  const corpus = (truth: 'source' | 'symptom'): DiagnosedCase[] =>
    ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'].map((datapack) =>
      kase({ datapack, services: services(), groundTruth: [truth], prediction: ['symptom'] }),
    );

  it('chooses on the training folds and reports the fold it never saw', () => {
    // The direction is worth +1 case per fold here: at weight 3 the callee wins, so a `source` corpus is fixed and a
    // `symptom` corpus is broken. Every fold must therefore be net-positive on the `source` corpus.
    const report = holdoutDirectionReport(corpus('source'), OPTS, DIRECTION_ARMS, 5);
    expect(report.folds).toHaveLength(5);
    expect(report.heldOutCases).toBe(10);
    // Every fold chose a non-zero weight on its training cases, and each is net-positive on its held-out ones.
    for (const choice of report.folds) {
      expect(choice.chosenWeight).toBeGreaterThan(0);
      expect(choice.heldOutCorrect).toBeGreaterThan(choice.baselineCorrect);
    }
    expect(report.chosen.every((weight) => weight === report.chosen[0])).toBe(true);
    expect(report.heldOutCorrect).toBeGreaterThan(report.heldOutBaseline);
  });

  it('prints UNSTABLE when the folds want different weights', () => {
    // The truth is set BY FOLD: folds 0, 1 and 2 reward the direction, folds 3 and 4 punish it. Holding out a
    // punishing fold leaves three rewarding folds in training and one punishing one, so it chooses 3; holding out
    // fold 0 leaves two and two, and the tie-break takes 0. Two different weights is exactly what the verdict reports.
    const ids = Array.from({ length: 50 }, (_, index) => `mixpack-${index}`);
    const cases = ids.map((datapack) =>
      kase({
        datapack,
        services: services(),
        groundTruth: [foldOf(datapack, 5) <= 2 ? 'source' : 'symptom'],
        prediction: ['symptom'],
      }),
    );
    const report = holdoutDirectionReport(cases, OPTS, DIRECTION_ARMS, 5);
    expect(new Set(report.chosen).size).toBeGreaterThan(1);
    expect(formatHoldoutReport(report)).toContain('UNSTABLE weight across folds');
  });

  it('renders a corpus that names no root, without dividing by zero', () => {
    const report = holdoutDirectionReport(
      [kase({ datapack: 'empty', services: services(), groundTruth: [] })],
      OPTS,
      DIRECTION_ARMS,
      5,
    );
    expect(report.agreement.cases).toBe(0);
    expect(formatHoldoutReport(report)).toContain('0/0');
    expect(formatHoldoutReport(report)).not.toContain('NaN');
  });

  it('prints a NEGATIVE fold net, which is the fold a chosen weight loses', () => {
    // The corpus is built BY FOLD using the real split: every case in fold 0 has the direction reversed, and every case
    // elsewhere is one the direction fixes. The four training folds then choose weight 3 (it wins everywhere they can
    // see), and fold 0 is where that choice is wrong — the shape a per-fold net has to be able to show as a minus.
    const ids = Array.from({ length: 30 }, (_, index) => `foldpack-${index}`);
    const cases = ids.map((datapack) =>
      kase({
        datapack,
        services: services(),
        groundTruth: [foldOf(datapack, 5) === 0 ? 'symptom' : 'source'],
        prediction: ['symptom'],
      }),
    );
    const report = holdoutDirectionReport(cases, OPTS, DIRECTION_ARMS, 5);
    const first = report.folds.find((fold) => fold.fold === 0)!;
    expect(first.chosenWeight).toBeGreaterThan(0);
    expect(first.heldOutCorrect).toBeLessThan(first.baselineCorrect);
    expect(formatHoldoutReport(report)).toContain('-');
  });

  it('answers 0 for a baseline it was not given, in the held-out protocol too', () => {
    // A menu without a zero arm has no arm to read the baseline from, and the alternative to answering 0 is a lookup
    // on `undefined` that takes the whole report down. The held-out net then reads as the distance from zero.
    const report = holdoutDirectionReport(corpus('source'), OPTS, [{ weight: 3, claim: 'on' }], 5);
    for (const choice of report.folds) expect(choice.baselineCorrect).toBe(0);
    expect(report.heldOutBaseline).toBe(0);
    expect(report.heldOutCorrect).toBe(10);
    // With no baseline, nothing can be "broken" — there is no arm to have been right where this one was wrong.
    for (const choice of report.folds) expect(choice.broken).toEqual([]);
  });

  it('states the bar it is judged by, and says STABLE or UNSTABLE from the choices themselves', () => {
    const stable = formatHoldoutReport(
      holdoutDirectionReport(corpus('source'), OPTS, DIRECTION_ARMS, 5),
    );
    expect(stable).toContain('STABLE weight across folds');
    expect(stable).toContain(HOLDOUT_BAR);
    // The agreement is printed FIRST, because law 41 applies to a held-out report exactly as it does to a full one.
    expect(stable.split('\n')[1]).toContain('baseline agreement');
  });

  it('chooses ZERO when the direction would break every case, which is the protocol working', () => {
    // Measured, not assumed: on a corpus where the callee is never the truth, weight 0 scores best on the training
    // folds, so every fold chooses 0 and the held-out projection is "no change" rather than a loss. A cross-validation
    // that could pick a harmful arm here would be choosing on the wrong side of the split.
    const report = holdoutDirectionReport(corpus('symptom'), OPTS, DIRECTION_ARMS, 5);
    expect(report.chosen).toEqual([0, 0, 0, 0, 0]);
    expect(report.heldOutCorrect).toBe(report.heldOutBaseline);
    // The per-fold split is still printed, so a net built out of regressions cannot hide inside a total.
    expect(formatHoldoutReport(report)).toMatch(/\d+ \/ \d+/);
    expect(formatHoldoutReport(report)).toContain('STABLE weight across folds');
  });
});

describe('faultTypeSplit — the unit the engine\u2019s acceptance criterion is stated in', () => {
  it('reports the types that got WORSE, which is what a case count cannot say', () => {
    const cases = [
      kase({ datapack: 'a1', faultType: 'gainer', services: services(), groundTruth: ['source'] }),
      kase({ datapack: 'a2', faultType: 'gainer', services: services(), groundTruth: ['source'] }),
      kase({ datapack: 'b1', faultType: 'loser', services: services(), groundTruth: ['symptom'] }),
    ];
    const split = faultTypeSplit(cases, OPTS, 3);
    const byType = new Map(split.movements.map((row) => [row.faultType, row]));
    expect(byType.get('gainer')).toMatchObject({ cases: 2, baselineCorrect: 0, correct: 2 });
    expect(byType.get('loser')).toMatchObject({ cases: 1, baselineCorrect: 1, correct: 0 });
    // A net of +1 case that regressed a TYPE is exactly the shape the kill criterion rejects.
    expect(split.regressed).toEqual(['loser']);
  });

  it('skips a case that names no root, and counts one with a root but no services as unwinnable', () => {
    // Both populations the other screens already handle: a case with no root is not part of any population here, and a
    // case with a root but no ranked service is counted (depressing the type equally) rather than dropped.
    const cases = [
      kase({ datapack: 'n1', faultType: 'noRoot', services: services(), groundTruth: [] }),
      kase({ datapack: 'n2', faultType: 'noServices', services: [], groundTruth: ['ghost'] }),
    ];
    const split = faultTypeSplit(cases, OPTS, 3);
    expect(split.movements.map((row) => row.faultType)).toEqual(['noServices']);
    expect(split.movements[0]).toMatchObject({ cases: 1, baselineCorrect: 0, correct: 0 });
    expect(split.regressed).toEqual([]);
  });

  it('reports no regression at weight 0, because the arm IS the baseline there', () => {
    const cases = [
      kase({ datapack: 'a1', faultType: 'x', services: services(), groundTruth: ['source'] }),
      kase({ datapack: 'b1', faultType: 'y', services: services(), groundTruth: ['symptom'] }),
    ];
    const split = faultTypeSplit(cases, OPTS, 0);
    expect(split.regressed).toEqual([]);
    for (const row of split.movements) expect(row.correct).toBe(row.baselineCorrect);
  });
});
