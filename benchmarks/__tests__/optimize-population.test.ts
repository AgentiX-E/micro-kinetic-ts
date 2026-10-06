/**
 * Guards on what the weight search's artifact says about its own corpus.
 *
 * ## The gap
 *
 * `optimize-rcaeval-results` reported `loaded 199 cases`, `split: train=140 val=27 test=32` and three
 * accuracies — and nothing about which cases those were. Two consequences, and the second is why this file
 * exists:
 *
 * - a reader cannot tell whether the tuning saw all three systems, or which fault types the held-out splits
 *   are missing (the split strata are `system:suite:fault`; 27 and 32 cases cannot hold one of each);
 * - **nobody could tell whether `rankNormalization` acted on it at all.** The engine's guard is
 *   `nodes >= ANOMALY_NORMALIZE_NODE_THRESHOLD`, so on a corpus of small graphs the rescale this repository
 *   keeps ON is inert — and the previous iteration's prediction that the alignment would move this artifact's
 *   numbers could not be checked afterwards, because the artifact never said how many cases were large enough
 *   for the flag to do anything. That is the difference between a number and a measurement.
 *
 * @module benchmarks/__tests__/optimize-population
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ANOMALY_NORMALIZE_NODE_THRESHOLD } from '../../packages/tree/src/index.js';
import {
  formatPopulation,
  formatSplitCapability,
  parseStratum,
  strataCovered,
  summarizePopulation,
  summarizeSplitCapability,
  type PopulationCase,
} from '../src/optimize-population.js';

const SIZE = ANOMALY_NORMALIZE_NODE_THRESHOLD;

/** A corpus with every interesting property: three systems, three suites, both sides of the guard. */
const CORPUS: PopulationCase[] = [
  { stratum: 'OnlineBoutique:re1:cpu', nodes: 12 },
  { stratum: 'OnlineBoutique:re1:cpu', nodes: SIZE },
  { stratum: 'OnlineBoutique:re2:memory', nodes: SIZE + 1 },
  { stratum: 'SockShop:re1:cpu', nodes: 12 },
  { stratum: 'TrainTicket:re3:disk', nodes: 48 },
  { stratum: 'TrainTicket:re3:disk:extra', nodes: SIZE - 1 },
];

describe('the corpus summary partitions what it counts', () => {
  it('makes every partition sum to the total', () => {
    const s = summarizePopulation(CORPUS);
    const sum = (r: Readonly<Record<string, number>>): number =>
      Object.values(r).reduce((a, b) => a + b, 0);
    // Both directions matter: a partition that loses a case and one that double-counts both sum wrong, and
    // they are the two ways a hand-maintained counter goes bad.
    expect(s.total).toBe(CORPUS.length);
    expect(sum(s.bySystem)).toBe(s.total);
    expect(sum(s.bySuite)).toBe(s.total);
    expect(sum(s.byFault)).toBe(s.total);
    expect(s.bySystem['TrainTicket']).toBe(2);
    expect(s.byFault['cpu']).toBe(3);
  });

  it('counts a graph AT the threshold as acting, and one below it as not', () => {
    // The engine's own guard is `nodes >= ANOMALY_NORMALIZE_NODE_THRESHOLD`. An off-by-one here would
    // misreport exactly the case a reader is most likely to check by hand — and it would be INVISIBLE, since
    // both sides of the boundary look plausible.
    const s = summarizePopulation([
      { stratum: 'S:re1:cpu', nodes: SIZE },
      { stratum: 'S:re1:cpu', nodes: SIZE - 1 },
    ]);
    expect(s.acting.count).toBe(1);
    expect(s.acting.bySystem['S']).toBe(1);
  });

  it('reads the threshold from the engine rather than carrying a copy of it', () => {
    // A hardcoded 20 in this module would survive a change to the engine's threshold and then describe a
    // population the engine no longer has. Asserted on the SOURCE, because the value alone cannot distinguish
    // "imported" from "typed the same number".
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../src/optimize-population.ts'),
      'utf8',
    );
    expect(source).toMatch(/import \{ ANOMALY_NORMALIZE_NODE_THRESHOLD \}/);
    expect(formatPopulation(summarizePopulation(CORPUS), 'corpus').join('\n')).toContain(
      `nodes >= ${ANOMALY_NORMALIZE_NODE_THRESHOLD}`,
    );
  });

  it('says so when the flag could not have acted at all', () => {
    // The case that matters most: a corpus entirely below the threshold reports numbers that are independent
    // of the axis, whatever the flag says. Saying "0/6 acting" is weaker than saying what that costs, so the
    // line states the consequence rather than leaving it to be inferred.
    const small = CORPUS.filter((c) => c.nodes < SIZE);
    const lines = formatPopulation(summarizePopulation(small), 'corpus').join('\n');
    expect(lines).toContain('rankNormalization acts on 0/');
    expect(lines).toContain('cannot distinguish the flag from its opposite');
    // And with an acting population it reports the breakdown instead of the caveat.
    const linesBig = formatPopulation(summarizePopulation(CORPUS), 'corpus').join('\n');
    expect(linesBig).toContain('acting system:');
    expect(linesBig).not.toContain('cannot distinguish the flag');
  });

  it('renders deterministically, so two runs of one corpus diff to nothing', () => {
    const shuffled = [...CORPUS].reverse();
    expect(formatPopulation(summarizePopulation(shuffled), 'corpus')).toEqual(
      formatPopulation(summarizePopulation(CORPUS), 'corpus'),
    );
    // And the label distinguishes populations in one artifact.
    expect(formatPopulation(summarizePopulation(CORPUS), 'test')[0]).toContain('population[test]');
  });
});

describe('the stratum key survives a fault name that contains a colon', () => {
  it('keeps a three-part key apart, and joins the rest back into the fault', () => {
    expect(parseStratum('OnlineBoutique:re3:cpu')).toEqual({
      system: 'OnlineBoutique',
      suite: 're3',
      fault: 'cpu',
    });
    // A fault name with its own colon must not be truncated into the suite's slot.
    expect(parseStratum('TrainTicket:re3:pod:fail')).toEqual({
      system: 'TrainTicket',
      suite: 're3',
      fault: 'pod:fail',
    });
    // A malformed key is NAMED, not dropped: refusing to summarise a corpus would hide it instead.
    expect(parseStratum('OnlineBoutique')).toEqual({
      system: 'OnlineBoutique',
      suite: 'unknown',
      fault: 'unknown',
    });
    expect(parseStratum(':re1:cpu').system).toBe('unknown');
  });

  it('counts distinct strata, which is the question the held-out splits need answered', () => {
    // The fixture holds SIX cases across FIVE distinct strata — `OnlineBoutique:re1:cpu` appears twice, on
    // both sides of the threshold — so this assertion distinguishes "count the cases" from "count the strata"
    // rather than passing under either. The rest of the describe block above depends on both numbers.
    const corpus = summarizePopulation(CORPUS);
    expect(corpus.total).toBe(6);
    expect(strataCovered(CORPUS)).toBe(5);
    expect(strataCovered(CORPUS.filter((c) => c.stratum.startsWith('TrainTicket')))).toBe(2);
    expect(strataCovered([])).toBe(0);
  });
});

describe('the module reaches the package without its barrel', () => {
  it('imports the specific module, never the package index', () => {
    // THE DEFECT THIS PINKS, which passed locally and failed in CI: importing
    // `packages/optimize/src/index.js` re-exports `persistence.js`, which imports
    // `@agentix-e/micro-kinetic-storage-fs` — a workspace package the benchmarks test environment does not
    // resolve, because the benchmarks job never builds it. The failure was at COLLECT time ("Failed to
    // resolve entry for package"), so every test in the file died rather than one assertion.
    //
    // Locally it passed for a reason worth writing down: `packages/optimize/node_modules/@agentix-e/
    // micro-kinetic-storage-fs/dist/index.cjs` existed from a build three weeks earlier. A package's entry
    // that exists only because of a STALE BUILD is not a resolution this repository can rely on, and the
    // guard therefore asserts the SOURCE shape rather than trusting a green local run — which is exactly the
    // run that was misleading.
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../src/optimize-population.ts'),
      'utf8',
    );
    expect(source).toMatch(/packages\/optimize\/src\/split\.js/);
    expect(source).not.toMatch(/packages\/optimize\/src\/index\.js/);
    // And the module it reaches is standalone, so the chain ends there: `split.ts` imports nothing, which is
    // what makes this import safe in an environment that resolves nothing transitively.
    const split = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/optimize/src/split.ts'),
      'utf8',
    );
    expect(
      split.split('\n').filter((l) => l.startsWith('import ')),
      'split.ts is standalone',
    ).toEqual([]);
  });
});

describe('the split capability the held-out numbers depend on', () => {
  const RATIOS = { train: 0.7, val: 0.15, test: 0.15 } as const;

  it('counts the strata too small to appear in BOTH held-out splits', () => {
    // The previous iteration printed the SYMPTOM (`val=26`, `test=28` of 44). This is the cause, and it is a
    // joint property of the corpus and the ratios rather than of either alone.
    const cases: PopulationCase[] = [
      ...Array.from({ length: 6 }, () => ({ stratum: 'big', nodes: 30 })),
      ...Array.from({ length: 5 }, () => ({ stratum: 'five', nodes: 30 })),
      { stratum: 'one', nodes: 30 },
    ];
    const cap = summarizeSplitCapability(cases, RATIOS);
    expect(cap.minimum).toBe(6);
    expect(cap.strata).toBe(3);
    // `big` meets the boundary; `five` and `one` do not, and they are named with their sizes ascending.
    expect(cap.belowMinimum).toEqual([
      { stratum: 'one', size: 1 },
      { stratum: 'five', size: 5 },
    ]);
  });

  it('names the smallest strata rather than only counting them', () => {
    // "30 of 44 are too small" invites the reader to assume they are uninteresting; the names are what let
    // that be checked, so the line carries them.
    const cases: PopulationCase[] = [
      { stratum: 'ob:re3:cpu', nodes: 30 },
      { stratum: 'ss:re3:f5', nodes: 30 },
      { stratum: 'tt:re1:cpu', nodes: 30 },
      { stratum: 'tt:re1:disk', nodes: 30 },
      ...Array.from({ length: 6 }, () => ({ stratum: 'tt:re1:mem', nodes: 30 })),
    ];
    const line = formatSplitCapability(summarizeSplitCapability(cases, RATIOS), RATIOS, 2);
    expect(line).toContain('a stratum needs 6+ cases for BOTH held-out splits at 70%/15%/15%');
    // FIVE distinct strata in the fixture, of which the four singletons are below the boundary and the
    // six-case one is not.
    expect(line).toContain('4 of 5 strata are smaller');
    expect(line).toContain('smallest:');
    expect(line, 'truncated when there are more than the limit').toContain('…');
    expect(line.split('smallest:')[1]!.split(' ').filter(Boolean).length).toBeLessThanOrEqual(3);
  });

  it('says there is no threshold to meet when the ratios ask for no held-out split', () => {
    // `val: 0` is the DOWN-SAMPLE's shape, and a helper that reported a boundary there would be answering a
    // question nobody asked — the line says so instead.
    const line = formatSplitCapability(
      summarizeSplitCapability([{ stratum: 'a', nodes: 30 }], { train: 0.7, val: 0, test: 0.3 }),
      { train: 0.7, val: 0, test: 0.3 },
    );
    expect(line).toContain('no held-out threshold to meet');
    expect(line).not.toContain('are smaller');
  });

  it('renders identically for the same corpus in a different order', () => {
    const cases: PopulationCase[] = [
      { stratum: 'b', nodes: 30 },
      { stratum: 'a', nodes: 30 },
      ...Array.from({ length: 6 }, () => ({ stratum: 'c', nodes: 30 })),
    ];
    expect(
      formatSplitCapability(summarizeSplitCapability([...cases].reverse(), RATIOS), RATIOS),
    ).toBe(formatSplitCapability(summarizeSplitCapability(cases, RATIOS), RATIOS));
  });
});
