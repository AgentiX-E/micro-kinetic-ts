/**
 * The formulation screens: a pure rank transform, an ordering that states a total order, and a report that
 * refuses to call a trade a candidate.
 *
 * The four forms are measured on the real dump by `--discriminator`; these tests hold the PROPERTIES the
 * measurement rests on, because a wrong percentile or an order-dependent tie-break would change every number in
 * that table without failing anything on the corpus.
 *
 * @module benchmarks/__tests__/fse26-formulation
 */

import { describe, expect, it } from 'vitest';

import type { DiagnosedCase, DiagnosedService } from '../src/fse26-diagnose-analyze.js';
import {
  FORMULATION_FORMS,
  formatFormulationReport,
  formulationOrder,
  formulationScreens,
  midrankPercentiles,
} from '../src/fse26-formulation.js';
import type { TermOracleOptions } from '../src/fse26-term-oracle.js';

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

/** A service with every field the analyzer declares, so a fixture differs from reality in nothing it reads. */
function svc(
  overrides: Partial<DiagnosedService> & Pick<DiagnosedService, 'serviceId'>,
): DiagnosedService {
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
    ...overrides,
  };
}

/** A case with the fields the screens read; the rest defaulted so a fixture states only what it is about. */
function kase(overrides: Partial<DiagnosedCase> & Pick<DiagnosedCase, 'services'>): DiagnosedCase {
  return {
    datapack: 'd1',
    faultType: 'cpu',
    groundTruth: [],
    logSignalMode: 'count',
    prediction: [],
    edges: undefined,
    injectTimeMs: undefined,
    fieldDecimals: undefined,
    ...overrides,
  };
}

describe('midrankPercentiles', () => {
  it('gives equal values the same percentile, so input order cannot decide anything', () => {
    const forward = midrankPercentiles([10, 10, 20]);
    const reversed = midrankPercentiles([20, 10, 10]);
    // Two of three at the bottom: midrank 0.5 of a 0..2 scale → 0.25.
    expect(forward[0]).toBeCloseTo(0.25, 12);
    expect(forward[1]).toBeCloseTo(0.25, 12);
    expect(forward[2]).toBe(1);
    // The same members, the same percentiles — only the positions moved.
    expect(reversed[0]).toBe(1);
    expect(reversed[1]).toBeCloseTo(0.25, 12);
    expect(reversed[2]).toBeCloseTo(0.25, 12);
  });

  it('keeps an unmeasured member UNDEFINED rather than calling it the lowest', () => {
    // `0` would say "the term ranked it last", which is a measurement; `undefined` says the term is silent.
    const ranks = midrankPercentiles([5, undefined, 9]);
    expect(ranks[1]).toBeUndefined();
    expect(ranks[0]).toBe(0);
    expect(ranks[2]).toBe(1);
  });

  it('treats a single measured value as the whole population and a non-finite value as unmeasured', () => {
    expect(midrankPercentiles([7])).toEqual([1]);
    expect(midrankPercentiles([Number.NaN])).toEqual([undefined]);
    expect(midrankPercentiles([])).toEqual([]);
  });
});

describe('formulationOrder', () => {
  it('orders by the blend and states a total order when two scores are equal', () => {
    // Same anomaly and same log score, so the fused score ties exactly; the id decides, and it decides the SAME
    // way whatever order the rows arrive in.
    const a = svc({ serviceId: 'alpha', selfAnomaly: 5, logScore: 0 });
    const b = svc({ serviceId: 'beta', selfAnomaly: 5, logScore: 0 });
    const form = FORMULATION_FORMS.find((f) => f.name === 'all ranks')!;
    expect(formulationOrder(kase({ services: [a, b] }), OPTS, form)).toEqual(['alpha', 'beta']);
    expect(formulationOrder(kase({ services: [b, a] }), OPTS, form)).toEqual(['alpha', 'beta']);
  });

  it('reads the log term by RANK in a rank form and by VALUE where the form says magnitude', () => {
    // Two services where rank and value disagree: `beta` has the larger raw log score but `alpha` has the larger
    // anomaly, so which one wins depends on how the log term is read.
    const alpha = svc({ serviceId: 'alpha', selfAnomaly: 100, logScore: 1 });
    const beta = svc({ serviceId: 'beta', selfAnomaly: 0.001, logScore: 50 });
    const ranks = FORMULATION_FORMS.find((f) => f.name === 'all ranks')!;
    const latency = FORMULATION_FORMS.find((f) => f.name === 'latency rank only')!;
    // Both forms give the log term the same WEIGHT; what differs is that `latency rank only` keeps the raw value,
    // where 50 dwarfs 1 and the anomaly difference cannot compensate.
    expect(formulationOrder(kase({ services: [alpha, beta] }), OPTS, ranks)[0]).toBe('alpha');
    expect(formulationOrder(kase({ services: [alpha, beta] }), OPTS, latency)[0]).toBe('beta');
  });
});

describe('formulationScreens', () => {
  it('splits the population into fixed / broken / untouched, and the two sides never overlap', () => {
    // **The premise this test does NOT assert is that the shipped blend misses a given fixture.** Which service
    // `rankCase` returns first is the oracle's business and is pinned by its own suite; a fixture built here to
    // "make the shipped blend wrong" would encode a guess about its internals and fail for the wrong reason.
    // What belongs here is the INVARIANT the table's arithmetic rests on: every counted case lands in exactly one
    // of the three sets, and no case is on both sides of the split.
    const cases: DiagnosedCase[] = [
      kase({
        datapack: 'p1',
        services: [
          svc({ serviceId: 'a', selfAnomaly: 10 }),
          svc({ serviceId: 'b', selfAnomaly: 1 }),
        ],
        groundTruth: ['b'],
      }),
      kase({
        datapack: 'p2',
        services: [
          svc({ serviceId: 'c', selfAnomaly: 1 }),
          svc({ serviceId: 'd', selfAnomaly: 10 }),
        ],
        groundTruth: ['d'],
      }),
      kase({
        datapack: 'p3',
        services: [svc({ serviceId: 'e', selfAnomaly: 5, logScore: 2 })],
        groundTruth: ['e'],
      }),
    ];
    for (const screen of formulationScreens(cases, OPTS)) {
      expect(screen.cases).toBe(3);
      // One case cannot be both fixed and broken: the two sets come from disjoint predicates on the same pair
      // of outcomes.
      for (const id of screen.fixed) expect(screen.broken).not.toContain(id);
      // **The identity the table's `net` rests on.** `broken` is a SUBSET of the cases shipped got right and
      // `fixed` a subset of the ones it got wrong, so this is arithmetic rather than a coincidence: a fixture that
      // broke it would mean a case was counted in a set its own predicate excludes. Note what is NOT asserted:
      // `cases === shippedCorrect + broken.length` is FALSE whenever some case is wrong for both blends, which is
      // the normal case — `broken` is a subset, not a complement.
      expect(screen.correct).toBe(
        screen.shippedCorrect - screen.broken.length + screen.fixed.length,
      );
      // And neither total may exceed the population it was counted over.
      expect(screen.cases).toBeGreaterThanOrEqual(screen.shippedCorrect);
      expect(screen.cases).toBeGreaterThanOrEqual(screen.correct);
    }
  });

  it('skips a case that names no root, and never counts it as either outcome', () => {
    const screens = formulationScreens(
      [kase({ services: [svc({ serviceId: 'a' })], groundTruth: [] })],
      OPTS,
    );
    for (const screen of screens) {
      expect(screen.cases).toBe(0);
      expect(screen.shippedCorrect).toBe(0);
      expect(screen.fixed).toEqual([]);
      expect(screen.broken).toEqual([]);
    }
  });

  it('names a case the two blends DISAGREE on, on BOTH sides of the split', () => {
    // **Measured before it was asserted, and that ordering is the point.** The values below were read off the two
    // blends first: with `a` at anomaly 1000 / log 0 and `b` at anomaly 1 / log 50, the shipped blend picks `b` (the
    // log term's magnitude dominates) and `all ranks` picks `a`. So ONE fixture covers both arms of the split,
    // depending only on which service is the truth — which is what a split test has to do to be worth anything.
    //
    // This is the assertion the earlier version of this file LACKED: it checked identities that hold on empty sets,
    // and the coverage report said so (`206-207` uncovered) before any reviewer could.
    const services = () => [
      svc({ serviceId: 'a', selfAnomaly: 1000, logScore: 0 }),
      svc({ serviceId: 'b', selfAnomaly: 1, logScore: 50 }),
    ];
    const allRanks = FORMULATION_FORMS.filter((f) => f.name === 'all ranks');

    // The truth is the service the SHIPPED blend misses: `fixed`, and nothing broken.
    const fixedSide = formulationScreens(
      [kase({ datapack: 'x1', services: services(), groundTruth: ['a'] })],
      OPTS,
      allRanks,
    )[0]!;
    expect(fixedSide.shippedCorrect).toBe(0);
    expect(fixedSide.correct).toBe(1);
    expect(fixedSide.fixed).toEqual(['x1']);
    expect(fixedSide.broken).toEqual([]);

    // The truth is the service the shipped blend names: the same disagreement, the other way round.
    const brokenSide = formulationScreens(
      [kase({ datapack: 'x2', services: services(), groundTruth: ['b'] })],
      OPTS,
      allRanks,
    )[0]!;
    expect(brokenSide.shippedCorrect).toBe(1);
    expect(brokenSide.correct).toBe(0);
    expect(brokenSide.fixed).toEqual([]);
    expect(brokenSide.broken).toEqual(['x2']);
  });

  it('contributes NOTHING for an unmeasured member in a rank form, rather than ranking it last', () => {
    // `midrankPercentiles` returns `undefined` for a member it cannot measure, and the blend adds `0` for it — the
    // arm this covers. The alternative reading, `0` as a percentile, would assert the term placed that service BELOW
    // every measured one, which is a fabricated measurement of exactly the kind the coverage standard exists for.
    const services = [
      svc({ serviceId: 'measured', selfAnomaly: 10, logScore: undefined }),
      svc({ serviceId: 'unmeasured', selfAnomaly: undefined, logScore: undefined }),
    ];
    const screen = formulationScreens([kase({ services, groundTruth: ['measured'] })], OPTS, [
      FORMULATION_FORMS[0]!,
    ])[0]!;
    expect(screen.cases).toBe(1);
    // And the ordering still names a service: an undefined member must not throw, and the measured one must win.
    expect(formulationOrder(kase({ services }), OPTS, FORMULATION_FORMS[0]!)[0]).toBe('measured');
    // **The other arm of the same question**: a form that reads the base by MAGNITUDE has to answer `undefined` too,
    // and it answers `log1p(max(undefined ?? 0, 0)) = 0` — "this term says nothing about it", not a fabricated
    // magnitude. One fixture, two scales, both arms.
    expect(formulationOrder(kase({ services }), OPTS, FORMULATION_FORMS[1]!)[0]).toBe('measured');
  });

  it('counts a case with NO services as unwinnable rather than skipping it', () => {
    // A case whose `services` array is empty still names a root, so it enters the population and NEITHER blend can
    // name its root: both `order[0]` reads are `undefined`, both `?? ''` fallbacks fire, and `''` is never in the
    // root set (that set is built by filtering empty strings out). It therefore depresses both totals equally,
    // which is the honest reading — the case is in the corpus and neither formula wins it.
    const empty = kase({ datapack: 'empty', services: [], groundTruth: ['ghost'] });
    for (const screen of formulationScreens([empty], OPTS)) {
      expect(screen.cases).toBe(1);
      expect(screen.shippedCorrect).toBe(0);
      expect(screen.correct).toBe(0);
      expect(screen.fixed).toEqual([]);
      expect(screen.broken).toEqual([]);
    }
  });

  it('returns one screen per form, in the order the forms were given', () => {
    const screens = formulationScreens([], OPTS);
    expect(screens.map((s) => s.form.name)).toEqual(FORMULATION_FORMS.map((f) => f.name));
  });
});

describe('formatFormulationReport', () => {
  const base = { cases: 100, shippedCorrect: 50, fixed: [], broken: [] };

  it('calls a form that wins nothing a failure to help, not a trade', () => {
    const text = formatFormulationReport([
      { ...base, form: FORMULATION_FORMS[0]!, correct: 40, broken: ['x'] },
    ]);
    expect(text).toContain('does not help');
  });

  it('refuses to call a net gain with losses a candidate', () => {
    // The criterion's second half is zero regressed types, so `+5` that broke three is a MEASUREMENT of a conflict.
    const text = formatFormulationReport([
      {
        ...base,
        form: FORMULATION_FORMS[1]!,
        correct: 55,
        fixed: ['a'],
        broken: ['b', 'c', 'd'],
      },
    ]);
    expect(text).toContain('trades, cannot pass');
  });

  it('and says so plainly when a form dominates', () => {
    const text = formatFormulationReport([
      { ...base, form: FORMULATION_FORMS[2]!, correct: 60, fixed: ['a', 'b'], broken: [] },
    ]);
    expect(text).toContain('DOMINATES');
  });
});
