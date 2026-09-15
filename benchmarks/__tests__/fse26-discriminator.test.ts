/**
 * The specification for the discriminator screen.
 *
 * The distinguishing specs here are not about the arithmetic: they are about the three
 * disciplines the module claims — the features cannot see the label, the reported net is
 * HELD OUT, and a conflict that no feature resolves is reported as such rather than fitted
 * into existence.
 */

import { describe, expect, it } from 'vitest';

import { formatFSE26Diagnostic } from '../../packages/kinetic/src/benchmarks/index.js';
import { DEFAULT_HTTP_DOMINANCE_THRESHOLD } from '../../packages/tree/src/index.js';

import { parseDiagnosticDump } from '../src/fse26-diagnose-analyze.js';
import type { CaseOutcome } from '../src/fse26-discriminator.js';
import {
  DISCRIMINATOR_FEATURES,
  caseOutcomes,
  configDeltas,
  discriminatorConfigs,
  discriminatorScreen,
  evaluateRule,
  fitStump,
  foldOf,
  formatDiscriminatorReport,
} from '../src/fse26-discriminator.js';
import type { TermOracleOptions } from '../src/fse26-term-oracle.js';

const OPTS: TermOracleOptions = {
  logWeight: 1,
  latWeight: 0.561495,
  latFloor: 10.3,
  dominance: DEFAULT_HTTP_DOMINANCE_THRESHOLD,
  dominanceGrid: [],
  poolWeight: 0.0679,
};

/** One rendered block, in the shape the producer writes it. */
function block(
  specs: readonly {
    serviceId: string;
    selfAnomaly?: number;
    logScore?: number;
    latRise?: number;
    dominant?: string;
  }[],
  overrides: {
    datapack?: string;
    faultType?: string;
    groundTruth?: readonly string[];
    topPredictions?: readonly string[];
  } = {},
): string {
  const n = specs.length;
  const services = specs.map((spec, index) => ({
    serviceId: spec.serviceId,
    metricNames: ['cpu'],
    dominantMetric: spec.dominant ?? 'cpu',
    selfAnomaly: spec.selfAnomaly ?? (n < 2 ? 1 : (n - 1 - index) / (n - 1)),
    logScore: spec.logScore ?? 0,
    failedEdgeScore: 0,
    failedEdgeRecords: 0,
    latRise: spec.latRise,
    latEdges: 0,
    errorCount: 0,
    fatalCount: 0,
    logicExceptionCount: 0,
    httpExceptionCount: 0,
    sampleErrorMessages: [],
    exceptionClasses: [],
    metricOutcomes: undefined,
  }));
  services.sort((a, b) => b.selfAnomaly - a.selfAnomaly);
  return formatFSE26Diagnostic({
    datapack: overrides.datapack ?? 'dp-1',
    faultType: overrides.faultType ?? 'JVMMemoryStress',
    groundTruthServices: [...(overrides.groundTruth ?? ['ts-root'])],
    services,
    topPredictions: [...(overrides.topPredictions ?? [])],
    logSignalMode: 'logicHttp',
  });
}

/** A hand-built outcome, so the fitting specs do not depend on the reconstruction. */
function outcome(
  datapack: string,
  covered: readonly string[],
  features: Readonly<Record<string, number>> = {},
  faultType = 'JVMMemoryStress',
): CaseOutcome {
  return { datapack, faultType, covered, features };
}

describe('discriminatorConfigs', () => {
  it('names the shipped configuration as a point of the same menu', () => {
    const configs = discriminatorConfigs(OPTS);
    expect(configs.map((config) => config.name)).toEqual([
      'log only',
      'metric only',
      'lat only',
      'shipped',
    ]);
    // The shipped point carries the run's own weights, so a rule that "chooses shipped" is
    // choosing the configuration under test and not a lookalike.
    expect(configs.at(-1)).toEqual({ name: 'shipped', logWeight: 1, latWeight: 0.561495 });
  });
});

describe('DISCRIMINATOR_FEATURES — the label is not reachable', () => {
  it('gives the same feature vector for two cases that differ ONLY in their ground truth', () => {
    // The discipline, made behavioural: a feature that could tell the two apart would be a
    // feature that read the answer, and every number fitted on it would be circular.
    const caseA = parseDiagnosticDump(
      block(
        [
          { serviceId: 'ts-a', selfAnomaly: 0.9, logScore: 0.5, latRise: 100 },
          { serviceId: 'ts-b', selfAnomaly: 0.4, dominant: 'k8s.pod.phase' },
        ],
        { datapack: 'same', groundTruth: ['ts-a'], topPredictions: ['ts-a'] },
      ),
    )[0]!;
    const caseB = parseDiagnosticDump(
      block(
        [
          { serviceId: 'ts-a', selfAnomaly: 0.9, logScore: 0.5, latRise: 100 },
          { serviceId: 'ts-b', selfAnomaly: 0.4, dominant: 'k8s.pod.phase' },
        ],
        { datapack: 'same', groundTruth: ['ts-b'], topPredictions: ['ts-a'] },
      ),
    )[0]!;

    for (const feature of DISCRIMINATOR_FEATURES) {
      expect(feature.name).toBeTruthy();
      expect(Number.isFinite(feature.of(caseA))).toBe(true);
      expect(feature.of(caseA)).toBe(feature.of(caseB));
    }
  });

  it('declares every feature by name, so a rule can be printed', () => {
    expect(DISCRIMINATOR_FEATURES.map((feature) => feature.name)).toEqual([
      'n',
      'metricTopGap',
      'metricSpread',
      'logCoverage',
      'latCoverage',
      'poolCoverage',
      'predictedIsTop',
      'predictedAnomaly',
    ]);
  });
});

describe('caseOutcomes', () => {
  it('records which configurations name a root, and the feature vector', () => {
    const cases = parseDiagnosticDump(
      block(
        [
          { serviceId: 'ts-root', selfAnomaly: 0.9 },
          { serviceId: 'ts-other', selfAnomaly: 0.1 },
        ],
        { datapack: 'easy', groundTruth: ['ts-root'], topPredictions: ['ts-root'] },
      ),
    );
    const [one] = caseOutcomes(cases, OPTS);

    expect(one!.datapack).toBe('easy');
    // The root is the top anomaly, so every configuration that ranks by it names the root.
    expect(one!.covered).toContain('shipped');
    expect(one!.features['metricTopGap']).toBeCloseTo(0.8, 9);
    expect(one!.features['predictedIsTop']).toBe(1);
  });

  it('skips a case with no acceptable root rather than counting it as covered by none', () => {
    const cases = parseDiagnosticDump(block([{ serviceId: 'ts-a' }], { groundTruth: [] }));
    expect(caseOutcomes(cases, OPTS)).toEqual([]);
  });
});

describe('configDeltas — the two populations a rule must separate', () => {
  it('partitions the cases into fixed, broken and neutral', () => {
    const outcomes = [
      outcome('a', ['shipped']),
      outcome('b', ['log only']),
      outcome('c', ['shipped', 'log only']),
      outcome('d', []),
    ];
    const [delta] = configDeltas(outcomes);

    expect(delta!.config).toBe('log only');
    expect(delta!.fixed).toEqual(['b']);
    expect(delta!.broken).toEqual(['a']);
    // A case both configurations get right, another neither gets: where the choice is moot.
    expect(delta!.neutral).toBe(2);
  });
});

describe('foldOf', () => {
  it('is deterministic, in range, and spreads over the folds', () => {
    const names = Array.from({ length: 200 }, (_, index) => `ts0-case-${index}`);
    const first = names.map((name) => foldOf(name, 5));
    expect(first).toEqual(names.map((name) => foldOf(name, 5)));
    expect(first.every((fold) => fold >= 0 && fold < 5)).toBe(true);
    expect(new Set(first).size).toBe(5);
  });
});

describe('fitStump', () => {
  it('finds the threshold that separates the fixed cases from the broken ones', () => {
    // `metricTopGap` is large exactly on the cases the alternative fixes, and small on the
    // cases it breaks, so a threshold exists and the fit must find it.
    const outcomes = [
      outcome('f1', ['log only'], { metricTopGap: 0.9 }),
      outcome('f2', ['log only'], { metricTopGap: 0.8 }),
      outcome('b1', ['shipped'], { metricTopGap: 0.1 }),
      outcome('b2', ['shipped'], { metricTopGap: 0.2 }),
    ];
    const choice = fitStump(outcomes, 'log only');

    expect(choice?.feature).toBe('metricTopGap');
    expect(choice?.direction).toBe(1);
    expect(choice!.threshold).toBeGreaterThan(0.5);
    expect(evaluateRule(outcomes, choice!).net).toBe(2);
  });

  it('returns nothing when no threshold has a positive net', () => {
    // The populations overlap: whatever threshold is chosen, every fix is paid for.
    const outcomes = [
      outcome('a', ['log only'], { n: 1 }),
      outcome('b', ['shipped'], { n: 1 }),
      outcome('c', ['log only'], { n: 2 }),
      outcome('d', ['shipped'], { n: 2 }),
    ];
    expect(fitStump(outcomes, 'log only')).toBeUndefined();
  });
});

describe('evaluateRule', () => {
  it('leaves a case the rule does not fire on with the baseline', () => {
    const outcomes = [outcome('a', ['shipped'], { n: 0 }), outcome('b', ['log only'], { n: 9 })];
    const choice = { config: 'log only', feature: 'n', threshold: 5, direction: 1 } as const;

    expect(evaluateRule(outcomes, choice)).toEqual({ fixed: 1, broken: 0, net: 1 });
  });
});

describe('discriminatorScreen — the net must be held out', () => {
  it('reports a POSITIVE held-out net when a feature really separates', () => {
    // Sixteen cases, one fold-worth distinguishable by the feature: the rule fitted on the
    // other folds has to carry over, so this measures generalisation and not the fit.
    const outcomes = Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0
        ? outcome(`fix-${index}`, ['log only'], { metricTopGap: 0.9 })
        : outcome(`keep-${index}`, ['shipped'], { metricTopGap: 0.1 }),
    );
    const screen = discriminatorScreen(outcomes, 5);

    expect(screen.folds).toBe(5);
    expect(screen.baselineCorrect).toBe(10);
    expect(screen.oracleCeiling).toBe(20);
    expect(screen.rules[0]!.config).toBe('log only');
    expect(screen.rules[0]!.heldOutNet).toBe(10);
    // The same fit scores higher on the data it saw, which is exactly why the held-out
    // number is the one the report leads with.
    expect(screen.rules[0]!.inSampleNet).toBe(10);
  });

  it('reports NO positive net when the two populations share their feature values', () => {
    const outcomes = [
      outcome('a', ['log only'], { metricTopGap: 0.5 }),
      outcome('b', ['shipped'], { metricTopGap: 0.5 }),
      outcome('c', ['log only'], { metricTopGap: 0.5 }),
      outcome('d', ['shipped'], { metricTopGap: 0.5 }),
    ];
    const screen = discriminatorScreen(outcomes, 2);

    expect(screen.rules[0]!.heldOutNet).toBeLessThanOrEqual(0);
    expect(formatDiscriminatorReport(screen)).toContain('no rule beats the baseline');
  });

  it('scores a fold whose training set chose no rule as zero, not as absent', () => {
    // A fold with no positive training net leaves its cases with the baseline; skipping the
    // fold instead would let a rule's net be reported from the folds that happened to work.
    // Twenty cases with a CONSTANT feature vector: every threshold is a coin flip, so no
    // training set finds a positive net, and the held-out total must be zero from a full
    // set of folds rather than from an empty one.
    const outcomes = Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0
        ? outcome(`fix-${index}`, ['log only'], { n: 1 })
        : outcome(`keep-${index}`, ['shipped'], { n: 1 }),
    );
    const screen = discriminatorScreen(outcomes, 4);

    expect(screen.rules[0]!.folds).toHaveLength(4);
    expect(screen.rules[0]!.folds.every((fold) => fold.choice === undefined)).toBe(true);
    expect(screen.rules[0]!.heldOutNet).toBe(0);
  });
});

describe('the degenerate shapes a real dump contains', () => {
  /**
   * A service row is OPTIONAL in every one of these features, and a feature that divides by
   * the candidate count has to survive a count of zero. Rendered through the real formatter
   * with no services at all, a block is still a block — and the features must return numbers
   * rather than `NaN`, because a threshold fit over `NaN` silently drops the case.
   */
  const shape = (
    overrides: Parameters<typeof block>[1] = {},
    specs: Parameters<typeof block>[0] = [],
  ) => caseOutcomes(parseDiagnosticDump(block(specs, overrides)), OPTS)[0];

  it('returns a finite feature vector for a case with NO service rows', () => {
    const one = shape({ datapack: 'empty', groundTruth: ['ts-root'], topPredictions: ['ts-root'] });

    expect(one).toBeDefined();
    for (const feature of DISCRIMINATOR_FEATURES) {
      expect(Number.isFinite(one!.features[feature.name]!)).toBe(true);
      expect(one!.features[feature.name]).toBe(0);
    }
  });

  it('reads a prediction that names no service as 0, and one that names a missing row as 0', () => {
    const noPrediction = shape(
      { datapack: 'no-pred', groundTruth: ['ts-root'], topPredictions: [] },
      [{ serviceId: 'ts-root', selfAnomaly: 0.9 }],
    );
    const missingRow = shape(
      { datapack: 'missing', groundTruth: ['ts-root'], topPredictions: ['ts-absent'] },
      [{ serviceId: 'ts-root', selfAnomaly: 0.9 }],
    );

    // A prediction the engine made about a service its own dump does not describe is a fact
    // about the case, not a measurement: it reads as 0 rather than as `NaN`.
    expect(noPrediction!.features['predictedIsTop']).toBe(0);
    expect(missingRow!.features['predictedAnomaly']).toBe(0);
  });

  it('records the configurations that DO name the root, and omits the rest', () => {
    // Both arms of the coverage test in one fixture. Note that the metric term cannot be
    // switched OFF — every point of the menu keeps `log1p(metric)` as its base — so "log
    // only" is the metric base plus the log term, and the root has to out-score the top
    // anomaly on the LOG term alone for any configuration to name it.
    const one = shape({ datapack: 'mixed', groundTruth: ['ts-mid'], topPredictions: ['ts-top'] }, [
      { serviceId: 'ts-top', selfAnomaly: 0.9 },
      { serviceId: 'ts-mid', selfAnomaly: 0.5, logScore: 1 },
    ]);

    expect(one!.covered).toContain('log only');
    expect(one!.covered).not.toContain('metric only');
  });

  it('records an EMPTY coverage rather than omitting the case (the unreachable block)', () => {
    // A case no configuration in the menu names is not skipped: it is a row with an empty
    // coverage, which is what makes `oracleCeiling < cases` a readable statement rather
    // than a silent one. Here the log term credits the top anomaly and every other term
    // agrees with it, so the root at the bottom is out of the menu's reach.
    const one = shape(
      { datapack: 'unreachable', groundTruth: ['ts-low'], topPredictions: ['ts-high'] },
      [
        { serviceId: 'ts-high', selfAnomaly: 0.9, logScore: 1 },
        { serviceId: 'ts-low', selfAnomaly: 0.1 },
      ],
    );

    expect(one!.covered).toEqual([]);
  });
});

describe('fitStump — the direction that fires on LOW values', () => {
  it('fits a `<=` rule when the small values are the ones to switch on', () => {
    // The mirror of the `>=` spec, and a real shape: `n` being small can mean the case is
    // sparse enough that the metric-only configuration is the trustworthy one.
    const outcomes = [
      outcome('f1', ['metric only'], { n: 3 }),
      outcome('f2', ['metric only'], { n: 4 }),
      outcome('b1', ['shipped'], { n: 60 }),
      outcome('b2', ['shipped'], { n: 70 }),
    ];
    const choice = fitStump(outcomes, 'metric only');

    expect(choice?.feature).toBe('n');
    expect(choice?.direction).toBe(-1);
    expect(evaluateRule(outcomes, choice!).net).toBe(2);
  });

  it('renders a `<=` rule as such, so a reader cannot apply the wrong side', () => {
    const outcomes = [
      outcome('f1', ['metric only'], { n: 3 }),
      outcome('f2', ['metric only'], { n: 4 }),
      outcome('b1', ['shipped'], { n: 60 }),
    ];
    const text = formatDiscriminatorReport(discriminatorScreen(outcomes, 3));

    expect(text).toContain('<=');
  });
});

describe('discriminatorScreen — fewer cases than folds', () => {
  it('skips an empty test fold rather than scoring it as zero', () => {
    // With more folds than cases a fold can be empty. Scoring it as zero and scoring it as
    // absent differ in the fold COUNT, which is what a report's arithmetic is checked
    // against — so the empty fold is dropped and the count says so.
    const outcomes = [
      outcome('only-1', ['log only'], { metricTopGap: 0.9 }),
      outcome('only-2', ['log only'], { metricTopGap: 0.9 }),
    ];
    const screen = discriminatorScreen(outcomes, 5);

    expect(screen.rules[0]!.folds.length).toBeLessThan(5);
    expect(screen.rules[0]!.folds.every((fold) => fold.test > 0)).toBe(true);
  });
});

describe('formatDiscriminatorReport', () => {
  it('prints both nets per configuration, and the rule that was fitted', () => {
    const outcomes = Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0
        ? outcome(`fix-${index}`, ['log only'], { metricTopGap: 0.9 })
        : outcome(`keep-${index}`, ['shipped'], { metricTopGap: 0.1 }),
    );
    const text = formatDiscriminatorReport(discriminatorScreen(outcomes, 5));

    expect(text).toContain('shipped gets 10');
    expect(text).toContain('ANY configuration gets 20');
    expect(text).toContain('held-out');
    expect(text).toContain('in-sample');
    expect(text).toContain('metricTopGap');
    expect(text).toContain('best held-out: log only net +10 (fixed 10, broken 0)');
  });

  it('names the two populations when a configuration both fixes and breaks cases', () => {
    // The conflict in miniature: the alternative fixes ten cases and breaks five, and the
    // feature separates the fixed ones from the broken ones — so the numbers printed on both
    // sides are the ones a reader has to weigh.
    const outcomes = [
      ...Array.from({ length: 10 }, (_, index) =>
        outcome(`fix-${index}`, ['log only'], { metricTopGap: 0.9 }),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        outcome(`break-${index}`, ['shipped'], { metricTopGap: 0.1 }),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        outcome(`both-${index}`, ['shipped', 'log only'], { metricTopGap: 0.5 }),
      ),
    ];
    const text = formatDiscriminatorReport(discriminatorScreen(outcomes, 5));

    expect(text).toContain('log only: fixes 10 and breaks 5');
  });
});
