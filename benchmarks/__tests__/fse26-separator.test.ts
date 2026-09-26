import { describe, expect, it } from 'vitest';

import type { DiagnosedCase, DiagnosedService } from '../src/fse26-diagnose-analyze.js';
import { foldOf } from '../src/fse26-discriminator.js';
import {
  DEFAULT_SEPARATOR_CRITERION,
  INVENTORY_MATCH_BAND,
  SEPARATOR_SCALARS,
  SEPARATOR_SIGNALS,
  SERVICE_FIELD_AUDIT,
  adjustedAlphaOver,
  formatSeparatorCensus,
  fromScalar,
  inventoryComparable,
  screenedFields,
  separationPValue,
  separatorCensus,
  unscreenedFields,
} from '../src/fse26-separator.js';

/**
 * The fixture builds `DiagnosedCase` values directly rather than going through the
 * parser: this module's subject is the PAIRING rule and the arithmetic, and a test
 * that needed a dump would be measuring the reader it already has tests for.
 */
const svc = (serviceId: string, over: Partial<DiagnosedService> = {}): DiagnosedService => ({
  serviceId,
  isGroundTruth: false,
  predictedRank: undefined,
  selfAnomaly: 0,
  logScore: 0,
  failedEdgeScore: undefined,
  failedEdgeRecords: undefined,
  latRise: undefined,
  latEdges: undefined,
  onsetDelayMs: undefined,
  dominantMetric: '',
  errorCount: 0,
  fatalCount: 0,
  logicExceptionCount: 0,
  httpExceptionCount: 0,
  metricOutcomes: undefined,
  decisiveOutcome: undefined,
  ...over,
});

const kase = (datapack: string, over: Partial<DiagnosedCase> = {}): DiagnosedCase => ({
  datapack,
  faultType: 'JVMMemoryStress',
  groundTruth: [],
  logSignalMode: 'logicHttp',
  services: [],
  prediction: [],
  edges: undefined,
  injectTimeMs: undefined,
  fieldDecimals: undefined,
  ...over,
});

/** One wrong case: the engine's rank-1 is `winner`, the truth is `source`. */
const wrongCase = (
  datapack: string,
  over: Partial<DiagnosedCase> = {},
  services: readonly DiagnosedService[] = [
    svc('ts-src', { isGroundTruth: true, selfAnomaly: 0.9 }),
    svc('ts-rival', { selfAnomaly: 1 }),
  ],
): DiagnosedCase =>
  kase(datapack, {
    groundTruth: ['ts-src'],
    prediction: ['ts-rival', 'ts-src'],
    services,
    ...over,
  });

describe('separatorCensus — pairing', () => {
  it('pairs the true source with the engine’s rank-1, for WRONG cases only', () => {
    // A correct case has the source AS its winner, and comparing a service with
    // itself is a structural tie that would dilute every rate with cases the engine
    // already gets right — the same trap the guard census records.
    const right = kase('ok-1', {
      groundTruth: ['ts-src'],
      prediction: ['ts-src', 'ts-rival'],
      services: [svc('ts-src', { isGroundTruth: true, selfAnomaly: 1 }), svc('ts-rival')],
    });
    const census = separatorCensus([right, wrongCase('bad-1')]);
    expect(census.total.pairs).toBe(1);
    expect(census.rows.map((row) => row.faultType)).toContain('JVMMemoryStress');
  });

  it('counts a case whose source is absent from the dump instead of pairing it', () => {
    // The dump's service list is what the engine ranked; a case whose ground truth
    // names a service the block does not describe cannot be asked the question at all.
    // Silently dropping it would shrink the denominator invisibly.
    const orphan = kase('no-source', {
      groundTruth: ['ts-gone'],
      prediction: ['ts-rival'],
      services: [svc('ts-rival', { selfAnomaly: 1 })],
    });
    const census = separatorCensus([wrongCase('bad-1'), orphan]);
    expect(census.unpaired).toBe(1);
    expect(census.total.pairs).toBe(1);
  });

  it('takes the most anomalous ground-truth service, ties broken by id', () => {
    // Multi-root cases exist (a fault declared on a group). The source is the one the
    // engine itself would rank highest among them, which is a rule and not a choice:
    // picking the first would make the answer depend on the dump's row order.
    const two = wrongCase('multi', { groundTruth: ['ts-a', 'ts-b'], prediction: ['ts-rival'] }, [
      svc('ts-a', { isGroundTruth: true, selfAnomaly: 0.5 }),
      svc('ts-b', { isGroundTruth: true, selfAnomaly: 0.8 }),
      svc('ts-rival', { selfAnomaly: 1 }),
    ]);
    const tied = wrongCase('tied', { groundTruth: ['ts-b', 'ts-a'], prediction: ['ts-rival'] }, [
      svc('ts-b', { isGroundTruth: true, selfAnomaly: 0.7 }),
      svc('ts-a', { isGroundTruth: true, selfAnomaly: 0.7 }),
      svc('ts-rival', { selfAnomaly: 1 }),
    ]);
    const census = separatorCensus([two, tied]);
    const sourceOf = (datapack: string) =>
      census.pairs.find((pair) => pair.datapack === datapack)!.source.serviceId;
    expect(sourceOf('multi')).toBe('ts-b');
    expect(sourceOf('tied')).toBe('ts-a');
  });
});

describe('fromScalar — one preference rule for both sides', () => {
  const pair = {
    datapack: 'd',
    faultType: 't',
    source: svc('src', { selfAnomaly: 0.4 }),
    winner: svc('win', { selfAnomaly: 0.9 }),
  };
  const subject = {
    kase: kase('d'),
    latSlopes: new Map<string, number>(),
    onsetSlopes: new Map<string, number>(),
  };
  const scalar = (of: (service: DiagnosedService) => number | undefined, direction: 1 | -1 = 1) =>
    fromScalar({
      name: 'x',
      role: 'inventory',
      reads: ['selfAnomaly'],
      of: (service) => of(service),
      direction,
    });

  it('says which side the evidence favours, and in which direction', () => {
    expect(scalar((s) => s.selfAnomaly).prefers(pair, subject)).toBe('winner');
    // A LOWER value being better is the same rule read backwards — the onset delay is
    // the field that needs it: moving first is the evidence.
    expect(scalar((s) => s.selfAnomaly, -1).prefers(pair, subject)).toBe('source');
  });

  it('is a tie when the two sides are equal, and n/a when either cannot be measured', () => {
    expect(scalar(() => 1).prefers(pair, subject)).toBe('tie');
    // `n/a` is a statement about the measurement, not about the case: a reader who sees
    // it in the loss column has been told the opposite of the truth.
    expect(scalar((s) => (s.serviceId === 'src' ? 1 : undefined)).prefers(pair, subject)).toBe(
      'unmeasurable',
    );
    expect(scalar(() => undefined).prefers(pair, subject)).toBe('unmeasurable');
  });

  it('treats a missing optional field as the engine’s own zero', () => {
    // The engine's `latScore` is absent for a service with no rise and the ranking reads it
    // as 0, so the term's value here is 0 — not n/a. A screen that read it as n/a would be
    // measuring a different engine from the one that produced the ranking. The floor is
    // passed as 1 so the fixture's rise is credited at all: at the shipped floor a 2× rise
    // is MASKED on both sides, which is a property of the floor and not of the reader.
    const signal = separatorCensus(
      [
        wrongCase('missing', undefined, [
          svc('ts-src', { isGroundTruth: true }),
          svc('ts-rival', { selfAnomaly: 1, latRise: 2 }),
        ]),
      ],
      DEFAULT_SEPARATOR_CRITERION,
      1,
    );
    const lat = signal.total.cells.find((cell) => cell.name === 'lat')!;
    expect(lat.unmeasurable).toBe(0);
    expect(lat.winner).toBe(1);
  });
});

describe('separatorCensus — arithmetic', () => {
  const cases = [
    wrongCase('a', { faultType: 'T1' }, [
      svc('ts-src', { isGroundTruth: true, selfAnomaly: 1 }),
      svc('ts-rival', { selfAnomaly: 0.5 }),
    ]),
    wrongCase('b', { faultType: 'T1' }, [
      svc('ts-src', { isGroundTruth: true, selfAnomaly: 0.5 }),
      svc('ts-rival', { selfAnomaly: 1 }),
    ]),
    wrongCase('c', { faultType: 'T2' }, [
      svc('ts-src', { isGroundTruth: true, selfAnomaly: 0.5 }),
      svc('ts-rival', { selfAnomaly: 0.5 }),
    ]),
  ];

  it('counts the three outcomes and puts an unmeasurable pair outside the rate', () => {
    const census = separatorCensus(cases);
    const metric = census.total.cells.find((cell) => cell.name === 'metric')!;
    expect([metric.source, metric.winner, metric.tie, metric.unmeasurable]).toEqual([1, 1, 1, 0]);
    // A tie is half a win, because the question is \"does this signal rank the source
    // first\" and a tie does not.
    expect(metric.auc).toBeCloseTo(0.5, 12);
  });

  it('reports every type, each against its own pairs', () => {
    const census = separatorCensus(cases);
    const t1 = census.rows.find((row) => row.faultType === 'T1')!;
    const t2 = census.rows.find((row) => row.faultType === 'T2')!;
    expect([t1.pairs, t2.pairs]).toEqual([2, 1]);
    expect(t1.cells.find((cell) => cell.name === 'metric')!.auc).toBeCloseTo(0.5, 12);
    expect(t2.cells.find((cell) => cell.name === 'metric')!.auc).toBeCloseTo(0.5, 12);
  });

  it('reports a signal with nothing measurable as n/a rather than as 0 or 1', () => {
    const census = separatorCensus([
      wrongCase('n', undefined, [
        svc('ts-src', { isGroundTruth: true }),
        svc('ts-rival', { selfAnomaly: 1 }),
      ]),
    ]);
    const failures = census.total.cells.find((cell) => cell.name === 'failedEdge')!;
    expect(failures.unmeasurable).toBe(1);
    expect(failures.auc).toBeUndefined();
    expect(formatSeparatorCensus(census)).toContain('n/a');
  });

  it('counts the pairs where no non-term signal prefers the source', () => {
    // This is the block's headroom from non-term evidence, stated as a count: a pair in
    // it can only be fixed by evidence the dump does not carry.
    const census = separatorCensus([
      wrongCase('plain', undefined, [
        svc('ts-src', { isGroundTruth: true, selfAnomaly: 0.9 }),
        svc('ts-rival', { selfAnomaly: 1 }),
      ]),
    ]);
    expect(census.noNonTermPreference).toBe(1);
  });
});

describe('the criterion is pre-registered, and applied as written', () => {
  /**
   * A wrong case whose two signature-line counts are set independently, so a NON-term signal
   * (`sigLines`) can be made to prefer either side. The source/winner split is the point: a
   * fixture where every signal agrees would pass any criterion.
   */
  const caseWith = (datapack: string, sourceSig: number, winnerSig: number, faultType = 'T1') =>
    wrongCase(datapack, { faultType }, [
      svc('ts-src', { isGroundTruth: true, selfAnomaly: 0.5, logicExceptionCount: sourceSig }),
      svc('ts-rival', { selfAnomaly: 1, logicExceptionCount: winnerSig }),
    ]);

  it('accepts a non-term signal that separates and never points the wrong way', () => {
    const census = separatorCensus(
      [caseWith('a', 5, 0), caseWith('b', 5, 0), caseWith('c', 5, 0)],
      { minAuc: 0.6, minCases: 3 },
    );
    expect(census.candidates).toContain('sigLines');
  });

  it('rejects a signal that wins overall but loses a whole fault type', () => {
    // The criterion is the second half of the kill criterion: a global rate says nothing about
    // the fault type it is wrong on, and a type is the unit that can regress.
    const cases = [
      ...['a', 'b', 'c', 'd', 'e', 'f'].map((id) => caseWith(id, 5, 0, 'T1')),
      ...['g', 'h', 'i'].map((id) => caseWith(id, 0, 5, 'T2')),
    ];
    const census = separatorCensus(cases, { minAuc: 0.6, minCases: 3 });
    const sigLines = census.total.cells.find((cell) => cell.name === 'sigLines')!;
    expect(sigLines.auc).toBeCloseTo(2 / 3, 12);
    expect(sigLines.auc! > 0.6).toBe(true);
    expect(census.candidates).not.toContain('sigLines');
    // And the failure is visible rather than merely implied: the per-type table prints both,
    // so a reader can see the split the criterion was applied to.
    const text = formatSeparatorCensus(census);
    expect(text).toContain('T1');
    expect(text).toContain('T2');
  });

  it('never promotes a term-role signal, however perfectly it separates', () => {
    // The register closes every axis that is "a function of the service's own metric score".
    // A screen that could hand one back as a candidate would reopen those axes through the
    // side door — so the fixture makes the source win on the metric, giving the term its best
    // possible AUC, and the signal still cannot be a candidate.
    const wonOnMetric = wrongCase('perfect', undefined, [
      svc('ts-src', { isGroundTruth: true, selfAnomaly: 1 }),
      svc('ts-rival', { selfAnomaly: 0.2 }),
    ]);
    const census = separatorCensus([wonOnMetric], { minAuc: 0.6, minCases: 1 });
    const metric = census.total.cells.find((cell) => cell.name === 'metric')!;
    expect(metric.auc).toBeCloseTo(1, 12);
    expect(metric.role).toBe('term');
    expect(census.candidates).not.toContain('metric');
  });

  it('states the criterion in the census rather than in the caller', () => {
    // A bar that lives only in a verdict document is re-negotiated by the next reader.
    const census = separatorCensus([wrongCase('a')]);
    expect(census.criterion).toEqual(DEFAULT_SEPARATOR_CRITERION);
    expect(DEFAULT_SEPARATOR_CRITERION.minAuc).toBeGreaterThan(0.5);
    expect(formatSeparatorCensus(census)).toContain(`AUC >= ${DEFAULT_SEPARATOR_CRITERION.minAuc}`);
  });
});

describe('no signal may see the label', () => {
  it('gives two cases differing only in ground truth and prediction identical scalars', () => {
    // The typing cannot express this — the scalars take a service, not a case — so it is
    // asserted behaviourally: a scalar that read either field would value a service
    // differently depending on which case it sits in.
    const services = [
      svc('ts-a', { selfAnomaly: 0.3, logScore: 0.2, latRise: 4, latEdges: 2, onsetDelayMs: 10 }),
      svc('ts-b', { selfAnomaly: 0.9, logScore: 0.7, latRise: 1.5, latEdges: 1, onsetDelayMs: 5 }),
    ];
    const one = kase('a', {
      groundTruth: ['ts-a'],
      prediction: ['ts-b', 'ts-a'],
      services,
      edges: ['ts-a>ts-b'],
    });
    const other = kase('a', {
      groundTruth: ['ts-b'],
      prediction: ['ts-a', 'ts-b'],
      services,
      edges: ['ts-a>ts-b'],
    });
    const subject = {
      latSlopes: new Map([
        ['ts-a', 1],
        ['ts-b', 0.5],
      ]),
      onsetSlopes: new Map([
        ['ts-a', 0.5],
        ['ts-b', 0],
      ]),
    };
    for (const scalar of SEPARATOR_SCALARS) {
      for (const service of services) {
        expect(scalar.of(service, { kase: one, ...subject }), `${scalar.name} read the label`).toBe(
          scalar.of(service, { kase: other, ...subject }),
        );
      }
    }
  });

  it('declares every signal once, with a role', () => {
    const names = SEPARATOR_SIGNALS.map((signal) => signal.name);
    expect(new Set(names).size).toBe(names.length);
    for (const signal of SEPARATOR_SIGNALS) {
      expect(['term', 'inventory', 'evidence', 'time', 'topology']).toContain(signal.role);
    }
  });
});

describe('formatSeparatorCensus', () => {
  it('prints the count that frames the table', () => {
    const census = separatorCensus([wrongCase('a'), wrongCase('b')]);
    expect(formatSeparatorCensus(census)).toContain('2 wrong cases');
  });

  it('says so when no non-term signal passes the bar', () => {
    const census = separatorCensus([wrongCase('a')]);
    expect(formatSeparatorCensus(census)).toContain('no non-term signal passes');
  });
});

describe('the multiplicity bar, and the exact test behind it', () => {
  it('is the exact two-sided permutation p-value over the non-tie pairs', () => {
    // Five clean wins: 2 x 2^-5. Ten clean wins: 2 x 2^-10. Nothing measurable: no test.
    expect(separationPValue(5, 0)).toBeCloseTo(2 / 32, 12);
    expect(separationPValue(10, 0)).toBeCloseTo(2 / 1024, 12);
    // A split decision is no evidence at all.
    expect(separationPValue(3, 1)).toBeCloseTo(10 / 16, 12);
    expect(separationPValue(2, 2)).toBe(1);
    expect(separationPValue(0, 0)).toBeUndefined();
    // The test is symmetric in the two sides: a signal that prefers the WINNER everywhere is
    // as significant as one that prefers the source, and the sign is the AUC's job.
    expect(separationPValue(0, 7)).toBeCloseTo(separationPValue(7, 0)!, 12);
  });

  it('excludes ties from the test rather than counting them as half', () => {
    // They carry no direction. Counting them would report a signal that mostly ties as though
    // it had been measured on every pair — the same defect as reading `n/a` as a loss.
    expect(separationPValue(5, 0)).toBe(separationPValue(5, 0));
    const tiesHeavy = separatorCensus(
      [
        wrongCase('t', undefined, [
          svc('ts-src', { isGroundTruth: true, selfAnomaly: 1 }),
          svc('ts-rival', { selfAnomaly: 1 }),
        ]),
      ],
      { minAuc: 0.6, minCases: 1 },
    );
    const metric = tiesHeavy.total.cells.find((cell) => cell.name === 'metric')!;
    expect(metric.tie).toBe(1);
    expect(metric.p).toBeUndefined();
  });

  it('keeps the bar honest for a scan of this size', () => {
    // Sidak, not Bonferroni: 338 cells at alpha 0.05 is a bar near 1.5e-4, which is what makes
    // a 0.88 over 25 pairs a reading rather than a maximum.
    expect(adjustedAlphaOver(1)).toBeCloseTo(0.05, 12);
    const many = adjustedAlphaOver(338);
    expect(many).toBeGreaterThan(1e-4);
    expect(many).toBeLessThan(2e-4);
    // A degenerate scan cannot widen the bar to everything.
    expect(adjustedAlphaOver(0)).toBeCloseTo(0.05, 12);
  });

  it('promotes only cells that clear the bar, and says how many cells were scanned', () => {
    const strong = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) =>
      wrongCase(id, { faultType: 'T1' }, [
        svc('ts-src', { isGroundTruth: true, logicExceptionCount: 5 }),
        svc('ts-rival', { selfAnomaly: 1 }),
      ]),
    );
    const census = separatorCensus(strong, { minAuc: 0.6, minCases: 3 });
    // Eight clean wins is p = 2/256 = 0.0078, against a bar taken over the cells scanned.
    expect(census.readings).toBeGreaterThan(0);
    expect(census.survivors.map((cell) => `${cell.faultType}/${cell.signal}`)).toContain(
      'T1/sigLines',
    );
    const text = formatSeparatorCensus(census);
    expect(text).toContain('separate FOR the source at the bar');
    expect(text).toContain('T1/sigLines');
  });

  it('reports zero survivors as a measurement, not as a missing line', () => {
    const census = separatorCensus([wrongCase('a')]);
    expect(census.survivors).toEqual([]);
    expect(census.dominated).toEqual([]);
    const text = formatSeparatorCensus(census);
    expect(text).toContain('0/');
    // Both directions are printed, so `0 for` cannot be read as `nothing was measured`.
    expect(text).toContain('separate FOR the source');
    expect(text).toContain('separate AGAINST it');
    // And the count that moved from 43 to 0 when five signals were added names its MENU: it is a
    // function of the signal set, not of the dump, and a bare count invites the wrong reading.
    expect(text).toContain('non-term signals screened');
  });

  it('keeps a significantly WRONG-WAY cell out of the candidate list', () => {
    // The trap this test exists for: an AUC of 0.00 is exactly as significant as an AUC of 1.00,
    // so a screen that ranks or promotes on the p-value alone hands back the engine's best-argued
    // loss as a candidate. The two classes are disjoint lists, and the mirror one is reported.
    const cases = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) =>
      wrongCase(id, { faultType: 'T1' }, [
        svc('ts-src', { isGroundTruth: true }),
        svc('ts-rival', { selfAnomaly: 1, logicExceptionCount: 5 }),
      ]),
    );
    const census = separatorCensus(cases, { minAuc: 0.6, minCases: 3 });
    expect(census.survivors).toEqual([]);
    expect(census.dominated.map((cell) => `${cell.faultType}/${cell.signal}`)).toContain(
      'T1/sigLines',
    );
    // And the per-type `best` column still names the row's strongest FOR-source cell, so a row
    // whose every cell favours the winner does not print that cell as its best.
    expect(census.rows[0]!.cells.find((cell) => cell.name === 'sigLines')!.auc).toBe(0);
  });
});

describe('the fold vector — an in-sample survivor is not yet a claim', () => {
  /** One case whose `sigLines` favours the source (or the winner) by construction. */
  const caseOf = (id: string, sourceWins: boolean) =>
    wrongCase(id, { faultType: 'T1' }, [
      svc('ts-src', { isGroundTruth: true, logicExceptionCount: sourceWins ? 5 : 0 }),
      svc('ts-rival', { selfAnomaly: 1, logicExceptionCount: sourceWins ? 0 : 5 }),
    ]);

  it('splits by the SAME fold assignment the discriminator fits on', () => {
    // Imported, not re-derived: two modules splitting one dump differently would each hold out a
    // different fifth of it while both calling it held out.
    expect(foldOf('ts0-ts-auth-service-stress-nlpsfx', 5)).toBe(
      foldOf('ts0-ts-auth-service-stress-nlpsfx', 5),
    );
    expect(foldOf('a', 5)).toBeGreaterThanOrEqual(0);
    expect(foldOf('a', 5)).toBeLessThan(5);
  });

  it('reports a rate for every fold a surviving cell could measure', () => {
    const census = separatorCensus(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => caseOf(id, true)),
      { minAuc: 0.6, minCases: 3 },
    );
    const cell = census.survivors.find((one) => one.signal === 'sigLines')!;
    expect(cell.foldAuc).toHaveLength(5);
    expect(cell.stable).toBe(true);
    expect(cell.foldAuc.every((auc) => auc === undefined || auc === 1)).toBe(true);
  });

  it('marks a cell that is carried by one fold as UNSTABLE', () => {
    // The failure this guards: a per-type rate assembled from pairs that all sit in one fold is
    // the search maximum again, and shipping it would be shipping the scan.
    const ids = Array.from({ length: 40 }, (_, index) => `case-${index}`);
    const win = ids.filter((id) => foldOf(id, 5) !== 0);
    const lose = ids.filter((id) => foldOf(id, 5) === 0);
    expect(win.length).toBeGreaterThan(0);
    expect(lose.length).toBeGreaterThan(0);
    const census = separatorCensus(
      [...win.map((id) => caseOf(id, true)), ...lose.map((id) => caseOf(id, false))],
      { minAuc: 0.6, minCases: 3 },
    );
    const cell = census.survivors.find((one) => one.signal === 'sigLines')!;
    expect(cell.foldAuc[0]).toBe(0);
    expect(cell.stable).toBe(false);
    expect(formatSeparatorCensus(census)).toContain('UNSTABLE');
  });

  it('calls a uniformly WRONG-WAY cell stable too, because the flag is about direction', () => {
    // Measured on both populations, which is the only way this flag can be defined: it is printed
    // for the mirror list as well, where every fold is below 0.5 by construction. Defined as
    // "above 0.5 everywhere" it marked all 35 dominated cells UNSTABLE — including ones whose
    // five folds were all 0.00, the most uniform result in the table.
    const census = separatorCensus(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => caseOf(id, false)),
      { minAuc: 0.6, minCases: 3 },
    );
    const cell = census.dominated.find((one) => one.signal === 'sigLines')!;
    expect(cell.foldAuc.every((auc) => auc === 0)).toBe(true);
    expect(cell.stable).toBe(true);
    expect(formatSeparatorCensus(census)).not.toContain('UNSTABLE');
  });
});

describe('the inventory and topology signals, on a rendered inventory and a real graph', () => {
  /** One metric's fate line, with the decomposition the block prints for the deciding metric. */
  const fate = (label: string, outcome: string, deviation = 0, riseRatio = 0) => ({
    label,
    outcome,
    score: outcome === 'kept' ? 1 : 0,
    ...(outcome === 'kept'
      ? {
          breakdown: {
            deviation,
            trend: 0,
            cv: 0,
            burst: 0,
            riseRatio,
            dropRatio: 0,
            baselineMean: 1,
          },
        }
      : {}),
  });
  const cellOf = (census: ReturnType<typeof separatorCensus>, name: string) =>
    census.total.cells.find((cell) => cell.name === name)!;

  it('reads kept, transient, best deviation and best rise from the rendered inventory', () => {
    const census = separatorCensus([
      wrongCase('inv', undefined, [
        svc('ts-src', {
          isGroundTruth: true,
          metricOutcomes: [
            fate('a', 'kept', 0.9, 30),
            fate('b', 'kept', 0.2, 4),
            fate('c', 'transient-return'),
          ],
        }),
        svc('ts-rival', {
          selfAnomaly: 1,
          metricOutcomes: [fate('a', 'kept'), fate('b', 'idle')],
        }),
      ]),
    ]);
    // The source keeps two metrics with real excursions, the winner one with none.
    expect(cellOf(census, 'kept')).toMatchObject({ source: 1, winner: 0, tie: 0 });
    expect(cellOf(census, 'bestDev').source).toBe(1);
    expect(cellOf(census, 'bestRise').source).toBe(1);
    // Fewer transient drops is the evidence, so the source's single drop is a LOSS for it:
    // the direction is part of the signal, not of the reader.
    expect(cellOf(census, 'transientDrops')).toMatchObject({ source: 0, winner: 1 });
  });

  it('reads the call graph in both directions, through intermediates', () => {
    const withEdges = (edges: string[]) =>
      separatorCensus([
        wrongCase('g', { edges }, [
          svc('ts-src', { isGroundTruth: true }),
          svc('ts-mid'),
          svc('ts-rival', { selfAnomaly: 1 }),
        ]),
      ]);
    // Two hops: the winner is downstream of the source.
    expect(cellOf(withEdges(['ts-src>ts-mid', 'ts-mid>ts-rival']), 'reaches').source).toBe(1);
    expect(cellOf(withEdges(['ts-src>ts-mid', 'ts-mid>ts-rival']), 'inDegree').winner).toBe(1);
    // The reverse direction is the mirror statement.
    expect(cellOf(withEdges(['ts-rival>ts-src']), 'reaches').winner).toBe(1);
    // Disconnected, and mutually connected, are both ties: the graph does not order them, and a
    // signal that guessed either way would be inventing a mechanism.
    expect(cellOf(withEdges(['ts-src>ts-x', 'ts-rival>ts-x']), 'reaches').tie).toBe(1);
    expect(cellOf(withEdges(['ts-src>ts-rival', 'ts-rival>ts-src']), 'reaches').tie).toBe(1);
    // A recorded but EMPTY graph is a measurement: both sides have no callers.
    const empty = withEdges([]);
    expect(cellOf(empty, 'inDegree')).toMatchObject({ tie: 1, unmeasurable: 0 });
    expect(cellOf(empty, 'reaches')).toMatchObject({ tie: 1, unmeasurable: 0 });
  });

  it('is n/a for an inventory the block did not render', () => {
    const census = separatorCensus([wrongCase('no-inventory')]);
    for (const name of ['kept', 'transientDrops', 'bestDev', 'bestRise']) {
      expect(cellOf(census, name)).toMatchObject({ unmeasurable: 1, auc: undefined });
    }
  });

  it('breaks a tie between equally strong cells by name, so the table is deterministic', () => {
    // `bestDev` and `bestRise` are the same ordering here by construction (deviation == rise), so
    // the row's printed best must not depend on the cell order in the declaration array.
    const census = separatorCensus([
      wrongCase('tie', undefined, [
        svc('ts-src', { isGroundTruth: true, metricOutcomes: [fate('a', 'kept', 0.9, 0.9)] }),
        svc('ts-rival', { selfAnomaly: 1, metricOutcomes: [fate('a', 'kept')] }),
      ]),
    ]);
    expect(cellOf(census, 'bestDev').auc).toBe(cellOf(census, 'bestRise').auc);
    expect(formatSeparatorCensus(census)).toContain('bestDev');
  });

  it('sorts equal-p survivors by fault type, so two runs agree', () => {
    const strong = (id: string, faultType: string) =>
      wrongCase(id, { faultType }, [
        svc('ts-src', { isGroundTruth: true, logicExceptionCount: 5 }),
        svc('ts-rival', { selfAnomaly: 1 }),
      ]);
    const census = separatorCensus(
      [
        ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => strong(id, 'T2')),
        ...['i', 'j', 'k', 'l', 'm', 'n', 'o', 'p'].map((id) => strong(id, 'T1')),
      ],
      { minAuc: 0.6, minCases: 3 },
    );
    const sigLines = census.survivors.filter((cell) => cell.signal === 'sigLines');
    expect(sigLines.map((cell) => [cell.faultType, cell.p])).toEqual([
      ['T1', sigLines[0]!.p],
      ['T2', sigLines[0]!.p],
    ]);
  });
});

describe('the degenerate inputs a dump can carry', () => {
  it('skips an all-empty ground truth, and an empty id inside a mixed one', () => {
    // The dump writes `GT=[]` for a case with no acceptable root, and the unlabelled candidate row
    // has an EMPTY service id. Both are real: the first has no question to ask, the second must not
    // be taken as a source.
    const noRoot = kase('no-root', {
      groundTruth: [],
      prediction: ['ts-rival'],
      services: [svc('ts-rival', { selfAnomaly: 1 })],
    });
    const emptyName = kase('blank-name', {
      groundTruth: [''],
      prediction: ['ts-rival'],
      services: [svc('ts-rival', { selfAnomaly: 1 })],
    });
    const mixed = kase('mixed', {
      groundTruth: ['', 'ts-src'],
      prediction: ['ts-rival'],
      services: [
        svc('', { selfAnomaly: 9, isGroundTruth: true }),
        svc('ts-src', { isGroundTruth: true, selfAnomaly: 0.5 }),
        svc('ts-rival', { selfAnomaly: 1 }),
      ],
    });
    const census = separatorCensus([noRoot, emptyName, mixed]);
    expect(census.pairs).toHaveLength(1);
    expect(census.pairs[0]!.source.serviceId).toBe('ts-src');
    expect(census.unpaired).toBe(0);
  });

  it('ignores a malformed edge, and counts a second edge from the same caller', () => {
    const census = separatorCensus([
      wrongCase('edges', { edges: ['ts-src', '>broken', 'ts-src>ts-a', 'ts-src>ts-rival'] }, [
        svc('ts-src', { isGroundTruth: true }),
        svc('ts-a'),
        svc('ts-rival', { selfAnomaly: 1 }),
      ]),
    ]);
    // Two entries under one caller: the second must APPEND, not replace the first.
    const degree = census.total.cells.find((cell) => cell.name === 'inDegree')!;
    const reachesCell = census.total.cells.find((cell) => cell.name === 'reaches')!;
    expect(degree.source + degree.winner + degree.tie).toBe(1);
    expect(reachesCell.source).toBe(1);
  });

  it('follows a diamond without walking the second arrival twice', () => {
    const census = separatorCensus([
      wrongCase(
        'diamond',
        {
          edges: ['a>b', 'a>c', 'b>d', 'c>d', 'd>z'],
          groundTruth: ['a'],
          prediction: ['z', 'a'],
        },
        [
          svc('a', { isGroundTruth: true }),
          svc('b'),
          svc('c'),
          svc('d'),
          svc('z', { selfAnomaly: 1 }),
        ],
      ),
    ]);
    const cell = census.total.cells.find((one) => one.name === 'reaches')!;
    expect(cell.source).toBe(1);
  });

  it('reads a hand-built subject with an empty onset map as the engine’s own zero', () => {
    // `SeparatorSubject` is public: a caller may hand over a map that does not carry a service, and
    // then the scalar is the ranking's own `?? 0` rather than a missing measurement.
    const temporal = fromScalar(SEPARATOR_SCALARS.find((s) => s.name === 'temporal')!);
    const pair = {
      datapack: 'd',
      faultType: 't',
      source: svc('ts-src', { onsetDelayMs: 5 }),
      winner: svc('ts-rival', { selfAnomaly: 1 }),
    };
    const subject = {
      kase: kase('d'),
      latSlopes: new Map<string, number>(),
      onsetSlopes: new Map<string, number>(),
    };
    expect(temporal.prefers(pair, subject)).toBe('tie');
    expect(
      temporal.prefers(pair, {
        ...subject,
        onsetSlopes: new Map([
          ['ts-src', 1],
          ['ts-rival', 0],
        ]),
      }),
    ).toBe('source');
  });
});

describe('the survivor list under a scan wide enough to need the ellipsis', () => {
  /**
   * A type whose two sides differ in IN-DEGREE: the source has two callers, the engine's rank-1
   * none, so `inDegree` prefers the source. `withGraph: false` is the same case in a dump that
   * recorded no graph, which is how a fold of the vector ends up unmeasurable.
   *
   * Twelve pairs is the smallest block that clears the bar once a handful of cells are scanned;
   * below it the bar is `2^-k` and six clean wins do not reach it, which is the multiplicity
   * correction doing its job rather than a fixture limitation.
   */
  const typeBlock = (faultType: string, ids: readonly string[], withGraph: boolean) =>
    ids.map((id) =>
      wrongCase(
        id,
        {
          faultType,
          edges: withGraph ? [`a-${id}>${id}-src`, `b-${id}>${id}-src`] : undefined,
          groundTruth: [`${id}-src`],
          prediction: [`${id}-rival`, `${id}-src`],
        },
        [svc(`${id}-src`, { isGroundTruth: true }), svc(`${id}-rival`, { selfAnomaly: 1 })],
      ),
    );

  it('prints the ellipsis past six survivors, and orders them by p', () => {
    const cases = Array.from({ length: 8 }, (_, index) => `T${index}`).flatMap((faultType) =>
      typeBlock(
        faultType,
        Array.from({ length: 12 }, (_, i) => `${faultType}-${i}`),
        true,
      ),
    );
    const census = separatorCensus(cases, { minAuc: 0.6, minCases: 3 });
    expect(census.survivors.length).toBeGreaterThan(6);
    expect(census.survivors.map((cell) => cell.p)).toEqual(
      [...census.survivors].map((cell) => cell.p).sort((a, b) => a - b),
    );
    expect(formatSeparatorCensus(census)).toContain('…');
  });

  it('sorts survivors of DIFFERENT p by p, and marks a fold it could not measure', () => {
    // The IDs are chosen so fold 0 carries only graph-less cases, which is what leaves `inDegree`'s
    // fold 0 unmeasurable — rendered as `-` rather than as a rate of zero, and not counted against
    // the cell's stability.
    const graphful = Array.from({ length: 40 }, (_, index) => `g-${index}`).filter(
      (id) => foldOf(id, 5) !== 0,
    );
    const graphless = Array.from({ length: 40 }, (_, index) => `n-${index}`).filter(
      (id) => foldOf(id, 5) === 0,
    );
    expect(graphful.length).toBeGreaterThan(20);
    expect(graphless.length).toBeGreaterThan(3);
    const census = separatorCensus(
      [
        ...typeBlock('T1', graphful.slice(0, 12), true),
        ...typeBlock('T1', graphless.slice(0, 3), false),
        ...typeBlock('T2', graphful.slice(12, 32), true),
      ],
      { minAuc: 0.6, minCases: 3 },
    );
    const inDegree = census.survivors.filter((cell) => cell.signal === 'inDegree');
    expect(inDegree).toHaveLength(2);
    // Twenty decisive pairs sort ahead of twelve, because the sort key is p and not the count.
    expect(inDegree.map((cell) => cell.faultType)).toEqual(['T2', 'T1']);
    const twelve = inDegree[1]!;
    expect(twelve.foldAuc[0]).toBeUndefined();
    // An unmeasurable fold is not a fold that went the wrong way: the cell is still stable.
    expect(twelve.stable).toBe(true);
    expect(new Set(inDegree.map((cell) => cell.p)).size).toBe(2);
    expect(formatSeparatorCensus(census)).toContain('-');
  });

  it('orders rows by size and then by name, so a dump with two equal types is stable', () => {
    const cases = [
      ...['a', 'b', 'c'].map((id) => wrongCase(id, { faultType: 'ZZ' })),
      ...['d', 'e', 'f'].map((id) => wrongCase(id, { faultType: 'AA' })),
    ];
    const census = separatorCensus(cases);
    expect(census.rows.map((row) => row.faultType)).toEqual(['AA', 'ZZ']);
  });
});

describe('the field audit — which fields no signal reads, and why that is a claim', () => {
  it('classifies every field a DIAG service line carries, in both directions', () => {
    // The map is typed `Record<keyof DiagnosedService, string>`, so a field added to the reader
    // cannot reach main unclassified. What a type cannot check is the SPLIT: that the two lists are
    // disjoint, that together they are the whole schema, and that a `read:` names a real signal.
    const screened = screenedFields();
    const unscreened = unscreenedFields();
    const names = new Set(SEPARATOR_SCALARS.map((scalar) => scalar.name));
    for (const field of Object.keys(SERVICE_FIELD_AUDIT) as (keyof DiagnosedService)[]) {
      const entry = SERVICE_FIELD_AUDIT[field];
      expect(entry.trim().length, `${field} has no audit text`).toBeGreaterThan(0);
      if (!entry.startsWith('read:')) continue;
      // Every `read:` entry names at least one declared scalar, read off the text.
      const named = [...entry.matchAll(/`([a-zA-Z]+)`/g)].map((match) => match[1]!);
      expect(
        named.filter((name) => names.has(name)),
        `${field} names no signal`,
      ).not.toHaveLength(0);
    }
    expect(screened.filter((field) => unscreened.includes(field))).toEqual([]);
    expect([...screened, ...unscreened].sort()).toEqual(
      (Object.keys(SERVICE_FIELD_AUDIT) as (keyof DiagnosedService)[]).sort(),
    );
  });

  it('names exactly the two fields nothing screens, and each carries its reason', () => {
    // Pinned rather than computed: a field moving between these lists is a decision, and the test
    // is what forces it to be reviewed. Both are the label — reading either would be reading the
    // answer. `dominantMetric` moved OFF this list when the four composition scalars started using
    // it as a selector, which is a use of the field and not a use of the label's family value.
    expect([...unscreenedFields()].sort()).toEqual(['isGroundTruth', 'predictedRank']);
    expect(SERVICE_FIELD_AUDIT.isGroundTruth).toContain('label');
    expect(SERVICE_FIELD_AUDIT.dominantMetric).toContain('fse26-family-screen-verdict.md');
  });

  it('says which scalar reads each screened field', () => {
    expect(screenedFields()).toContain('failedEdgeRecords');
    expect(screenedFields()).toContain('metricOutcomes');
    expect(SEPARATOR_SCALARS.find((scalar) => scalar.name === 'edgeRecords')!.reads).toEqual([
      'failedEdgeRecords',
    ]);
  });
});

describe('the decisive composition — read from the metric that drove the score', () => {
  interface Composition {
    readonly deviation?: number;
    readonly trend?: number;
    readonly cv?: number;
    readonly burst?: number;
    readonly riseRatio?: number;
    readonly dropRatio?: number;
    readonly baselineMean?: number;
  }

  /** One kept metric carrying a decomposition. */
  const composed = (label: string, score: number, over: Composition = {}) => ({
    label,
    outcome: 'kept',
    score,
    breakdown: {
      deviation: 0,
      trend: 0,
      cv: 0,
      burst: 0,
      riseRatio: 0,
      dropRatio: 0,
      baselineMean: 0,
      ...over,
    },
  });

  /** A kept metric with no decomposition — the fate of a metric the block did not decompose. */
  const opaque = (label: string, score: number) => ({ label, outcome: 'kept', score });

  const scalar = (name: string) => SEPARATOR_SCALARS.find((s) => s.name === name)!;
  const subject = { kase: kase('probe'), latSlopes: new Map(), onsetSlopes: new Map() };
  const read = (name: string, service: DiagnosedService) => scalar(name).of(service, subject);

  it('reads the composition of the metric the engine named, not of the largest rise', () => {
    // The two disagree on the shipped dump: in 751 of 7,733 rendered rows (9.7%) the largest-rise
    // entry is NOT the entry the score was maximised over, so an argmax over `riseRatio` measures a
    // different metric from the one that decided the ranking — and the four `decisive*` signals were
    // read that way.
    const service = svc('ts-a', {
      dominantMetric: 'cpu.usage',
      metricOutcomes: [
        composed('cpu.usage', 0.9, { cv: 0.01, riseRatio: 3, trend: 0.5 }),
        composed('latency-90', 0.2, { cv: 0.9, riseRatio: 40, trend: 9 }),
      ],
    });

    expect(read('decisiveCv', service)).toBe(0.01);
    expect(read('decisiveTrend', service)).toBe(0.5);
  });

  it('falls back to the highest-scoring metric when the dump names no dominant one', () => {
    // `dominantMetric` is `''` when the engine recorded none. The fallback is the score ordering the
    // block itself uses — never the rise, which is a different quantity.
    const service = svc('ts-a', {
      metricOutcomes: [
        composed('cpu.usage', 0.9, { cv: 0.01, riseRatio: 3 }),
        composed('latency-90', 0.2, { cv: 0.9, riseRatio: 40 }),
      ],
    });

    expect(read('decisiveCv', service)).toBe(0.01);
  });

  it('falls back to the highest-scoring metric when the named one was not rendered', () => {
    // A name outside the rendered list cannot be looked up. The next best answer is the metric the
    // score was maximised over, which the block renders first.
    const service = svc('ts-a', {
      dominantMetric: 'not.rendered',
      metricOutcomes: [
        composed('cpu.usage', 0.9, { cv: 0.01, riseRatio: 3 }),
        composed('latency-90', 0.2, { cv: 0.9, riseRatio: 40 }),
      ],
    });

    expect(read('decisiveCv', service)).toBe(0.01);
  });

  it('reports no composition as absent, not as zero', () => {
    // A kept metric the block did not decompose has no composition to report. Zero is a measurement
    // — a perfectly stable series — so returning it here would turn "nothing was rendered" into a
    // tie between the two sides, which is a claim the dump does not support.
    const service = svc('ts-a', { metricOutcomes: [opaque('m', 1), opaque('n', 0.5)] });

    expect(read('decisiveCv', service)).toBeUndefined();
    expect(read('decisiveBurst', service)).toBeUndefined();
    expect(read('decisiveBaseline', service)).toBeUndefined();
  });

  it('reports no DECOMPOSITION as absent for the two maxima, and keeps the COUNT a measurement', () => {
    // The same fixture as the test above and the same rule one level down. The block rendered an
    // inventory and no decomposition for any of its kept metrics, so the two maxima are over an EMPTY
    // set; `0` is a measurement — a decomposed metric whose deviation is zero — and reporting it here
    // is not cosmetic. Measured: `artifacts/diag-34684319273` renders 2095 inventories and ZERO
    // decompositions, 2094 of them on labelled rows, and with a zero sentinel the screen printed
    // `bestDev inventory 319 0 0 319 0 0.500` — 319 pairs decided as TIES at 0.500 where the honest
    // reading is `unmeasurable`.
    const undecomposed = svc('ts-a', { metricOutcomes: [opaque('m', 1), opaque('n', 0.5)] });

    expect(read('bestDev', undecomposed)).toBeUndefined();
    expect(read('bestRise', undecomposed)).toBeUndefined();
    // The COUNTS are a different kind of number and stay measurements: `kept` is what the block
    // STATED (a `metricKept(2):` line), so an empty decomposition cannot make it absent.
    expect(read('kept', undecomposed)).toBe(2);
    expect(read('transientDrops', undecomposed)).toBe(0);

    // The other direction, so a reader that answered `undefined` for both maxima always cannot pass.
    const decomposed = svc('ts-a', {
      metricOutcomes: [opaque('m', 1), composed('n', 0.5, { deviation: 0.7, riseRatio: 12 })],
    });
    expect(read('bestDev', decomposed)).toBe(0.7);
    expect(read('bestRise', decomposed)).toBe(12);
  });

  it('takes the maxima over the DECOMPOSED metrics only, a lower bound rather than a total', () => {
    // The block renders a decomposition for at most three of the kept metrics, so the maximum over
    // them is a lower bound on the service's best deviation — and it must not be diluted by the
    // entries the block did not decompose, which is the other direction a sentinel can break.
    const partial = svc('ts-a', {
      metricOutcomes: [
        composed('a', 0.9, { deviation: 0.7, riseRatio: 12 }),
        opaque('b', 0.5),
        composed('c', 0.2, { deviation: 0.3, riseRatio: 40 }),
      ],
    });

    expect(read('bestDev', partial)).toBe(0.7);
    expect(read('bestRise', partial)).toBe(40);
    expect(read('kept', partial)).toBe(3);
  });

  it('makes a pair with no bound at all on either side UNMEASURABLE rather than a tie', () => {
    // The consequence, at the level the rate is computed on. `tie` is a MEASUREMENT — both sides were
    // decomposed and came out equal — and `unmeasurable` is left out of the rate and counted. Folding
    // the second into the first is what the zero sentinel did, and the register prefers to know which
    // of the two it is holding.
    const signal = fromScalar(scalar('bestDev'));
    const pair = {
      datapack: 'probe',
      faultType: 'JVMMemoryStress',
      source: svc('ts-src', { metricOutcomes: [opaque('m', 1)] }),
      winner: svc('ts-rival', { metricOutcomes: [opaque('m', 1)] }),
    };

    expect(signal.prefers(pair, subject)).toBe('unmeasurable');

    // One side decomposed is still `unmeasurable`: a difference against an absent value is not a
    // preference in either direction.
    expect(
      signal.prefers(
        {
          ...pair,
          source: svc('ts-src', { metricOutcomes: [composed('m', 1, { deviation: 0.5 })] }),
        },
        subject,
      ),
    ).toBe('unmeasurable');

    // Both sides decomposed and equal is a TIE — the value a sentinel would have produced for the
    // absent case, which is why the two must not be conflated.
    const zeroOnBoth = {
      ...pair,
      source: svc('ts-src', {
        metricOutcomes: [composed('m', 1, { deviation: 0, riseRatio: 0 })],
      }),
      winner: svc('ts-rival', {
        metricOutcomes: [composed('m', 1, { deviation: 0, riseRatio: 0 })],
      }),
    };
    expect(signal.prefers(zeroOnBoth, subject)).toBe('tie');
  });

  it('prefers the composition the dump STATES over its own rendered list', () => {
    // `metricDecisive` is rendered for every service and names the metric the engine maximised over,
    // so it is a read rather than a re-derivation. The rendered list stays as the fallback for blocks
    // that predate the line — which is why this fixture gives the two sources DIFFERENT numbers: a
    // fixture that agreed could not tell the precedence from the fallback.
    const service = svc('ts-a', {
      dominantMetric: 'cpu.usage',
      decisiveOutcome: {
        label: 'cpu.usage',
        outcome: 'kept',
        score: 0.2,
        breakdown: {
          deviation: 1,
          trend: 0.3,
          cv: 0.07,
          burst: 0.02,
          riseRatio: 2,
          dropRatio: 0.1,
          baselineMean: 5,
        },
      },
      metricOutcomes: [composed('latency-90', 0.9, { cv: 0.9, riseRatio: 40 })],
    });

    expect(read('decisiveCv', service)).toBe(0.07);
    expect(read('decisiveBaseline', service)).toBe(5);
  });

  it('reads a composition without an inventory, and keeps the inventory unmeasurable', () => {
    // A service the table never compares has a `metricDecisive` line and NO `metricKept` line. The
    // composition is therefore readable while the counts are absent — and absent must stay `undefined`
    // rather than becoming a count of zero, which is what a defaulted `kept` would report.
    const service = svc('ts-bystander', {
      decisiveOutcome: {
        label: 'cpu.usage',
        outcome: 'kept',
        score: 0.2,
        breakdown: {
          deviation: 1,
          trend: 0.3,
          cv: 0.07,
          burst: 0.02,
          riseRatio: 2,
          dropRatio: 0.1,
          baselineMean: 5,
        },
      },
    });

    expect(read('decisiveCv', service)).toBe(0.07);
    expect(read('kept', service)).toBeUndefined();
    expect(read('bestDev', service)).toBeUndefined();
  });

  it('prefers the engine’s name over the score ordering when both are available', () => {
    // On the shipped dump the two agree in 7,779 of 7,780 decomposed rows, so this pins a
    // precedence rather than a behaviour: it is here so that "the block renders the decisive metric
    // first" cannot be simplified into an assumption when only the name is actually the answer. The
    // divergence it guards against is the one that produced this fix — reading a metric the score
    // was not maximised over.
    const service = svc('ts-a', {
      dominantMetric: 'second',
      metricOutcomes: [
        composed('first', 0.9, { cv: 0.9, riseRatio: 1 }),
        composed('second', 0.4, { cv: 0.2, riseRatio: 1 }),
      ],
    });

    expect(read('decisiveCv', service)).toBe(0.2);
  });

  it('keeps reading the other four inventory numbers the same way', () => {
    // The composition changed; the maxima did not. `kept` and `transient` still count fates, and
    // `bestRise` is still the strongest rise among decomposed metrics.
    const service = svc('ts-a', {
      metricOutcomes: [opaque('m', 1), composed('n', 0.5, { deviation: 0.7, riseRatio: 12 })],
    });

    expect(read('kept', service)).toBe(2);
    expect(read('bestDev', service)).toBe(0.7);
    expect(read('bestRise', service)).toBe(12);
  });

  it('declares the selector field it depends on', () => {
    for (const name of ['decisiveTrend', 'decisiveCv', 'decisiveBurst', 'decisiveBaseline']) {
      expect(scalar(name).reads, name).toContain('dominantMetric');
    }
  });
});

describe('the coarsened inventory match — stating the stratum a confound check can use', () => {
  /** A rendered inventory of `kept` metrics, so two sides can agree or disagree on the count. */
  const inv = (serviceId: string, kept: number, anomaly: number) => ({
    ...svc(serviceId, { selfAnomaly: anomaly }),
    metricOutcomes: Array.from({ length: kept }, () => ({
      label: 'm',
      outcome: 'kept',
      score: 1,
    })),
  });

  it('treats a ratio up to the band as comparable, and zero only against zero', () => {
    expect(INVENTORY_MATCH_BAND).toBe(2);
    expect(inventoryComparable(10, 20)).toBe(true);
    expect(inventoryComparable(20, 10)).toBe(true);
    expect(inventoryComparable(10, 21)).toBe(false);
    expect(inventoryComparable(1, 2)).toBe(true);
    expect(inventoryComparable(1, 3)).toBe(false);
    expect(inventoryComparable(0, 0)).toBe(true);
    // A count's zero is a boundary rather than a small number: a ratio from zero is undefined, not
    // large, so a side that kept nothing is comparable only to another side that kept nothing.
    expect(inventoryComparable(0, 1)).toBe(false);
    expect(inventoryComparable(7, 0)).toBe(false);
  });

  it('counts the band-matched pairs beside the exactly-matched ones', () => {
    // Exact equality is the ideal conditioning and the one with no power — 26 of 662 pairs on the
    // shipped dump. The band is what gives the check something to stand on.
    const census = separatorCensus([
      wrongCase('exact', undefined, [inv('ts-src', 21, 0.4), inv('ts-rival', 21, 1)]),
      wrongCase('near', undefined, [inv('ts-src', 21, 0.4), inv('ts-rival', 30, 1)]),
      wrongCase('far', undefined, [inv('ts-src', 5, 0.4), inv('ts-rival', 41, 1)]),
    ]);
    expect(census.total.pairs).toBe(3);
    expect(census.total.sameInventoryPairs).toBe(1);
    expect(census.total.nearInventoryPairs).toBe(2);
    expect(census.inventoryBand).toBe(INVENTORY_MATCH_BAND);
  });

  it('reads a cell on the matched stratum rather than on the whole row', () => {
    // `kept` is measurable for every pair, so its matched cell is the arithmetic and nothing else:
    // the source keeps 2 against the winner's 3 (matched — a loss) and 1 against 5 (not matched,
    // so not in this rate).
    const census = separatorCensus([
      wrongCase('matched', undefined, [inv('ts-src', 2, 0.4), inv('ts-rival', 3, 1)]),
      wrongCase('unmatched', undefined, [inv('ts-src', 1, 0.4), inv('ts-rival', 5, 1)]),
    ]);
    const kept = census.total.cells.find((cell) => cell.name === 'kept')!;
    expect(kept.winner).toBe(2);
    expect(kept.near).toEqual({ pairs: 1, source: 0, winner: 1, tie: 0, auc: 0 });
  });

  it('prints the band with the matched columns, so the stratum is stated', () => {
    const text = formatSeparatorCensus(separatorCensus([wrongCase('one')]));
    expect(text).toContain('kept<=');
    expect(text).toMatch(/within a factor of 2/);
    expect(text).toContain('AUC(matched)');
  });
});

describe('the conditioning column — a confound check has to state its power', () => {
  /** A rendered inventory with `kept` metrics, so two sides can agree or disagree on the count. */
  const fate = (outcome: string) => ({ label: 'm', outcome, score: 1 });
  const withInventory = (serviceId: string, kept: number, anomaly: number) => ({
    ...svc(serviceId, { selfAnomaly: anomaly }),
    metricOutcomes: [...Array.from({ length: kept }, () => fate('kept')), fate('transient-return')],
  });

  it('counts the pairs whose two sides render the same number of kept metrics', () => {
    // Two pairs of one type: the first agrees on the count, the second does not. Only the first is
    // conditionable, and the row says so — the block renders a decomposition in proportion to how
    // many metrics a service keeps, so "does this composition signal survive that?" can only be
    // asked where the two sides agree.
    const census = separatorCensus([
      wrongCase('agree', undefined, [
        withInventory('ts-src', 3, 0.4),
        withInventory('ts-rival', 3, 1),
      ]),
      wrongCase('differ', undefined, [
        withInventory('ts-src', 3, 0.4),
        withInventory('ts-rival', 9, 1),
      ]),
    ]);
    expect(census.rows[0]!.pairs).toBe(2);
    expect(census.rows[0]!.sameInventoryPairs).toBe(1);
    expect(census.total.sameInventoryPairs).toBe(1);
    // And it prints with the table, because a saturated confound and an excluded one look alike in
    // every other column.
    expect(formatSeparatorCensus(census)).toContain('kept=');
  });

  it('does not count a pair whose inventory the block did not render at all', () => {
    // `undefined` is not a count of zero: an unrendered inventory cannot be compared, so it is not
    // conditionable either.
    const census = separatorCensus([wrongCase('no-inventory')]);
    expect(census.total.sameInventoryPairs).toBe(0);
  });
});
