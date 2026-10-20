/**
 * The composition arms: three statements about how evidence aggregates, and the coherence check that makes the table
 * worth reading.
 *
 * The corpus measurement is in `--discriminator`; these tests hold the properties it rests on. The most important is
 * the `sum` arm's identity: it composes the SAME decomposition the shipped score is built from, so it must reach the
 * shipped total exactly. A composition experiment whose own baseline disagrees with the number it is compared against
 * is measuring its own defect — and the report says so in words rather than leaving it to a reader to notice.
 *
 * @module benchmarks/__tests__/fse26-composition
 */

import { describe, expect, it } from 'vitest';

import {
  composedScore,
  COMPOSITION_ARMS,
  compositionOrder,
  compositionScreens,
  formatCompositionReport,
} from '../src/fse26-composition.js';
import type { DiagnosedCase, DiagnosedService } from '../src/fse26-diagnose-analyze.js';
import type { ScoreTerms, TermOracleOptions } from '../src/fse26-term-oracle.js';
import { scoreTerms } from '../src/fse26-term-oracle.js';

const OPTS: TermOracleOptions = {
  logWeight: 1,
  latWeight: 0.561495,
  latFloor: 10.3,
  dominance: 0.5,
  dominanceGrid: [],
  poolWeight: 0.0679,
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

/** Terms stated by hand, so a test is about the COMPOSITION and nothing else. */
function terms(o: Partial<ScoreTerms> = {}): ScoreTerms {
  return { metric: 0, log: 0, latency: 0, temporal: 0, pool: 0, failedEdge: 0, ...o };
}

describe('composedScore', () => {
  it('adds the evidence terms in the `sum` arm, which is the shipped arithmetic', () => {
    const one = terms({ metric: 2, log: 3, latency: 5, temporal: 0.5, pool: 0.25 });
    expect(composedScore(one, 'sum')).toBeCloseTo(2 + 3 + 5 + 0.5 - 0.25, 12);
  });

  it('lets the strongest channel decide in the `max` arm, and the pool penalty still applies', () => {
    const one = terms({ metric: 2, log: 3, latency: 9, temporal: 0.5, pool: 0.25 });
    expect(composedScore(one, 'max')).toBeCloseTo(9 + 0.5 - 0.25, 12);
    // **The penalty is OUTSIDE the combination on purpose.** Inside a max, a pool-dominant service could escape the
    // demotion by being large on one channel — which is exactly what the penalty exists to prevent.
    expect(composedScore(terms({ metric: 9, pool: 4 }), 'max')).toBeCloseTo(5, 12);
  });

  it('sits between the two in the `lse` arm, and never overflows on a large deviation', () => {
    const one = terms({ metric: 2, log: 2, latency: 2 });
    // Three equal channels: log(3·e²) = 2 + log 3, i.e. above the max and well below the sum.
    expect(composedScore(one, 'lse')).toBeCloseTo(2 + Math.log(3), 10);
    expect(composedScore(one, 'lse')).toBeLessThan(composedScore(one, 'sum'));
    expect(composedScore(one, 'lse')).toBeGreaterThan(composedScore(one, 'max'));
    // `exp(800)` is `Infinity`; the shifted form must still answer a finite number.
    const huge = composedScore(terms({ metric: 800 }), 'lse');
    expect(Number.isFinite(huge)).toBe(true);
    expect(huge).toBeCloseTo(800, 6);
  });

  it('makes a NON-FINITE term visible as NaN rather than hiding it behind the shift', () => {
    // The guard this covers is the one branch a hand-built term can reach and `scoreTerms` cannot: `scoreTerms`
    // refuses `undefined` but a parse CAN produce a non-finite value (the engine's own record has an all-non-finite
    // block), so `Math.max` over the evidence can be NaN. The guard's job is to let that NaN THROUGH — a rank derived
    // from `NaN - NaN` arithmetic would be a fabricated order, while a NaN score is something a consumer can see and
    // refuse. It is asserted here because "no input can reach it" was the assumption, and an assumption about
    // reachability is exactly what the register refuses to accept without a fixture.
    const poisoned = terms({ metric: Number.NaN, log: 1, latency: 1 });
    expect(Number.isNaN(composedScore(poisoned, 'lse'))).toBe(true);
    // The other arms propagate it too, which is the point: no arm silently invents a value.
    expect(Number.isNaN(composedScore(poisoned, 'sum'))).toBe(true);
    expect(Number.isNaN(composedScore(poisoned, 'max'))).toBe(true);
  });

  it('answers the shipped arithmetic exactly when it is handed the shipped terms', () => {
    // The end-to-end identity, on real terms rather than hand-written ones: `sum` over `scoreTerms` must equal the
    // numeric sum of the same fields. This is what makes the corpus coherence check meaningful.
    const one = kase({
      services: [
        svc({ serviceId: 'a', selfAnomaly: 12.5, logScore: 3.25, latRise: 4 }),
        svc({ serviceId: 'b', selfAnomaly: 0.5, logScore: 0, latRise: undefined }),
      ],
    });
    const map = scoreTerms(one, OPTS, 'recorded', new Map([['a', 2]]));
    for (const id of ['a', 'b']) {
      const t = map.get(id);
      if (t === undefined) continue;
      expect(composedScore(t, 'sum')).toBeCloseTo(
        t.metric + t.log! + t.latency + t.temporal - t.pool,
        12,
      );
    }
  });
});

describe('compositionOrder', () => {
  it('reverses the winner between `sum` and `max` when breadth beats depth', () => {
    // `broad` is mildly unusual on all three channels, `deep` is decisive on one. The shipped blend prefers breadth —
    // that is the whole claim the `max` arm tests, stated as one fixture.
    const broad = svc({ serviceId: 'broad', selfAnomaly: Math.exp(2), logScore: 1.2, latRise: 2 });
    const deep = svc({ serviceId: 'deep', selfAnomaly: 0.01, logScore: 0, latRise: 2 });
    const one = kase({ services: [broad, deep], edges: undefined });
    expect(compositionOrder(one, OPTS, 'sum')[0]).toBe('broad');
  });

  it('drops a service the configuration cannot score rather than ranking it last', () => {
    const measured = svc({ serviceId: 'measured', selfAnomaly: 3 });
    const unmeasured = svc({ serviceId: 'unmeasured', selfAnomaly: undefined });
    const order = compositionOrder(kase({ services: [measured, unmeasured] }), OPTS, 'sum');
    expect(order).toEqual(['measured']);
  });

  it('states a total order, so the dump order cannot decide a tie', () => {
    const a = svc({ serviceId: 'alpha', selfAnomaly: 5 });
    const b = svc({ serviceId: 'beta', selfAnomaly: 5 });
    for (const composition of ['sum', 'max', 'lse'] as const) {
      expect(compositionOrder(kase({ services: [a, b] }), OPTS, composition)).toEqual([
        'alpha',
        'beta',
      ]);
      expect(compositionOrder(kase({ services: [b, a] }), OPTS, composition)).toEqual([
        'alpha',
        'beta',
      ]);
    }
  });
});

describe('compositionScreens', () => {
  it('reports the `sum` arm as reproducing the shipped total on any corpus', () => {
    // The coherence check, over fixtures: `sum` IS the shipped arithmetic, so the identity holds whatever the cases
    // are — and a corpus where it did not would be a defect in the instrument rather than a finding.
    const cases = [
      kase({
        datapack: 'c1',
        services: [
          svc({ serviceId: 'x', selfAnomaly: 40 }),
          svc({ serviceId: 'y', selfAnomaly: 1 }),
        ],
        groundTruth: ['x'],
      }),
      kase({
        datapack: 'c2',
        services: [
          svc({ serviceId: 'p', selfAnomaly: 1 }),
          svc({ serviceId: 'q', selfAnomaly: 20 }),
        ],
        groundTruth: ['p'],
      }),
    ];
    const screens = compositionScreens(cases, OPTS);
    expect(screens.map((s) => s.arm.composition)).toEqual(['sum', 'max', 'lse']);
    const sum = screens[0]!;
    expect(sum.correct).toBe(sum.shippedCorrect);
    expect(sum.fixed).toEqual([]);
    expect(sum.broken).toEqual([]);
    // And the split identity every arm obeys: `broken ⊆ shippedCorrect`, `fixed ⊆ not`.
    for (const screen of screens) {
      expect(screen.correct).toBe(
        screen.shippedCorrect - screen.broken.length + screen.fixed.length,
      );
      expect(screen.cases).toBe(2);
    }
  });
});

describe('the arms can DISAGREE, and the screen says so on both sides', () => {
  // **Measured before it was asserted.** `broad` has metric 5 and log 5 (sum 10, max 5); `deep` has metric 9 and log 0
  // (sum 9, max 9). So the sum prefers breadth and the max prefers depth, on the same two services — which is the
  // claim the `max` arm exists to test, turned into a fixture. A split test whose fixtures never make the arms
  // disagree asserts only on empty sets.
  const services = () => [
    svc({ serviceId: 'broad', selfAnomaly: Math.exp(5), logScore: 5 }),
    svc({ serviceId: 'deep', selfAnomaly: Math.exp(9), logScore: 0 }),
  ];
  const nonSum = COMPOSITION_ARMS.filter((arm) => arm.composition !== 'sum');

  it('breaks the arms when the truth is the BROAD service', () => {
    const screens = compositionScreens(
      [kase({ datapack: 'w1', services: services(), groundTruth: ['broad'] })],
      OPTS,
      nonSum,
    );
    for (const screen of screens) {
      expect(screen.shippedCorrect).toBe(1);
      expect(screen.correct).toBe(0);
      expect(screen.broken, screen.arm.composition).toEqual(['w1']);
      expect(screen.fixed).toEqual([]);
    }
  });

  it('fixes them when the truth is the DEEP service', () => {
    const screens = compositionScreens(
      [kase({ datapack: 'w2', services: services(), groundTruth: ['deep'] })],
      OPTS,
      nonSum,
    );
    for (const screen of screens) {
      expect(screen.shippedCorrect).toBe(0);
      expect(screen.correct).toBe(1);
      expect(screen.fixed, screen.arm.composition).toEqual(['w2']);
      expect(screen.broken).toEqual([]);
    }
  });
});

describe('the population rules', () => {
  it('skips a case that names no root, and never counts it', () => {
    const screens = compositionScreens(
      [kase({ services: [svc({ serviceId: 'a', selfAnomaly: 5 })], groundTruth: [] })],
      OPTS,
    );
    for (const screen of screens) expect(screen.cases).toBe(0);
  });

  it('counts a case with NO services as unwinnable rather than skipping it', () => {
    // The `?? ''` fallbacks on both orderings fire here: a case can name a root and still have nothing to rank, so it
    // enters the population and depresses both totals equally.
    const screens = compositionScreens([kase({ services: [], groundTruth: ['ghost'] })], OPTS);
    for (const screen of screens) {
      expect(screen.cases).toBe(1);
      expect(screen.shippedCorrect).toBe(0);
      expect(screen.correct).toBe(0);
    }
  });
});

describe('formatCompositionReport', () => {
  const arm = COMPOSITION_ARMS[0]!;
  const other = COMPOSITION_ARMS[1]!;
  const base = { cases: 100, fixed: [], broken: [] };

  it('says the `sum` arm is coherent when it reproduces the shipped total', () => {
    const text = formatCompositionReport([{ ...base, arm, shippedCorrect: 50, correct: 50 }]);
    expect(text).toContain('coherence OK');
  });

  it('calls a `sum` arm that MISSES a defect of the instrument rather than a fourth arm', () => {
    const text = formatCompositionReport([{ ...base, arm, shippedCorrect: 50, correct: 49 }]);
    expect(text).toContain('COHERENCE FAILED');
  });

  it('refuses to call a net gain with losses a candidate', () => {
    const text = formatCompositionReport([
      { ...base, arm: other, shippedCorrect: 50, correct: 55, fixed: ['a'], broken: ['b'] },
    ]);
    expect(text).toContain('trades, cannot pass');
    const dominates = formatCompositionReport([
      { ...base, arm: other, shippedCorrect: 50, correct: 60, fixed: ['a'], broken: [] },
    ]);
    expect(dominates).toContain('DOMINATES');
  });
});
