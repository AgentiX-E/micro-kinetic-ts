/**
 * Unit tests for {@link mergeLoadStats}.
 *
 * This is the fold that decides whether the RCAEval runner's memory slicing is a rewrite of the ORDER a cell is
 * processed in or a silent change to what the cell reports. It has to hold for three different kinds of field at
 * once, and each kind fails differently:
 *
 * - a COUNT that is not added under-reports silently (the artifact prints a smaller population);
 * - a MEAN that is averaged instead of re-derived from its counts is wrong exactly when the slices are uneven, which
 *   is every cell whose size is not a multiple of the chunk — so the defect would appear on some cells only;
 * - a SUMMARY that is folded as a summary rather than recomputed from its rows reports a plausible number that no
 *   single pass would have produced.
 *
 * The censuses are therefore asserted AGAINST THEIR OWN SUMMARISER over the concatenated rows, not against a
 * hand-written expectation: that is the claim being made — "the fold is the single pass" — and restating the
 * census's arithmetic here would test a copy of it instead.
 *
 * @module __tests__/load-stats-fold
 */

import { describe, expect, it } from 'vitest';

import type { LatencyRouteEntry } from '../src/directional-evidence.js';
import { summarizeLatencyRoutes } from '../src/directional-evidence.js';
import type { LoadStats } from '../src/load-stats.js';
import { mergeLoadStats } from '../src/load-stats.js';
import type { LogRouteEntry } from '../src/log-route.js';
import { summarizeLogRoutes } from '../src/log-route.js';
import { summarizeInjectionAnchors } from '../src/rcaeval-corpus.js';

/** A latency-route row; the fields the census reads are the ones it sums, the rest are constants here. */
const latency = (wholeFileRows: number): LatencyRouteEntry => ({
  anchorPresent: true,
  capSpans: wholeFileRows,
  capPre: 0,
  capPost: wholeFileRows,
  shippedRows: 0,
  cappedRows: wholeFileRows,
  wholeFileRows,
});

/** A log-route row with one admitted, in-graph emitter. */
const logRoute = (mode: LogRouteEntry['mode'], admitted: number): LogRouteEntry => ({
  mode,
  rowsRead: admitted,
  retained: admitted,
  admitted,
  admittedInGraph: admitted,
  emitters: admitted > 0 ? 1 : 0,
  retainedByKind: { logic: 0, propagated: 0, unclassified: 0, none: admitted },
  // The stored flag is DEFINED as the taxonomy's `logic`, so a fixture that disagrees with it is a pipeline defect
  // rather than a case the census should have to explain. Zero is the only value a healthy corpus produces.
  flagDisagreements: 0,
  // The unclassified bucket is empty here because these rows ARE classified (`none`), which is what keeps the
  // census's verdict for this fixture about the GATE rather than about the whitelist's headroom.
  unclassifiedClasses: new Map<string, number>(),
});

/**
 * One slice's statistics.
 *
 * A builder rather than a literal because `LoadStats` has twelve fields and a test that restated all of them per
 * case would be unreadable; every field a test does not name is the value of a slice that saw no cases, so an
 * assertion that passes did so because the test set the field it is about.
 */
function stats(overrides: Partial<LoadStats> = {}): LoadStats {
  return {
    cases: [],
    // No per-edge latency rows: the coverage line reports what a case's metric keys covered, and a slice that saw
    // no cases has nothing to cover.
    failedEdgeCases: [],
    errors: [],
    errorSamples: new Map(),
    traceActivityCases: 0,
    considered: 0,
    traceStats: { total: 0, pruned: 0, avgEdgesBefore: 0, avgEdgesAfter: 0, header: '' },
    semanticStats: {
      totalServices: 0,
      semanticallyResolved: 0,
      embeddingResolved: 0,
      llmResolved: 0,
      exactMatched: 0,
    },
    latencyRoutes: summarizeLatencyRoutes([]),
    latencyRouteByCaseId: new Map(),
    logRoutes: summarizeLogRoutes([]),
    logRouteEntries: [],
    anchors: summarizeInjectionAnchors([]),
    anchorProvenances: [],
    logStats: {
      total: 0,
      errorEntries: 0,
      header: '',
      sampleTs: 0,
      sampleLevel: '',
      sampleService: '',
      sampleMsg: '',
      stackTraceEntries: 0,
      sampleStackTraceMsg: '',
    },
    exceptionNames: [],
    ...overrides,
  };
}

/**
 * A COHERENT slice: the censuses are derived from the rows beside them, which is the only shape `loadCases` emits.
 *
 * Built by a second function rather than folded into {@link stats} because the two answer different questions:
 * `stats` is "a slice that saw nothing, except for the fields named", which is what the count and mean tests need;
 * this is "a slice that saw these rows", which is what the identity tests need. A fixture whose summary disagreed
 * with its rows would be a slice no loader could produce, and a fold over it tests nothing.
 */
function coherent(overrides: Partial<LoadStats> = {}): LoadStats {
  const base = stats(overrides);
  return {
    ...base,
    logRoutes: summarizeLogRoutes(base.logRouteEntries),
    anchors: summarizeInjectionAnchors(base.anchorProvenances),
    latencyRoutes: summarizeLatencyRoutes([...base.latencyRouteByCaseId.values()]),
  };
}

describe('mergeLoadStats — the fold is the single pass', () => {
  it('adds every count', () => {
    const merged = mergeLoadStats([
      stats({
        considered: 12,
        traceActivityCases: 7,
        traceStats: { total: 11, pruned: 3, avgEdgesBefore: 20, avgEdgesAfter: 18, header: 'a' },
        semanticStats: {
          totalServices: 30,
          semanticallyResolved: 20,
          embeddingResolved: 15,
          llmResolved: 5,
          exactMatched: 10,
        },
        logStats: {
          total: 9,
          errorEntries: 40,
          header: 'h',
          sampleTs: 0,
          sampleLevel: '',
          sampleService: '',
          sampleMsg: '',
          stackTraceEntries: 6,
          sampleStackTraceMsg: '',
        },
      }),
      stats({
        considered: 5,
        traceActivityCases: 2,
        traceStats: { total: 4, pruned: 1, avgEdgesBefore: 10, avgEdgesAfter: 8, header: 'b' },
        semanticStats: {
          totalServices: 12,
          semanticallyResolved: 8,
          embeddingResolved: 6,
          llmResolved: 2,
          exactMatched: 4,
        },
        logStats: {
          total: 3,
          errorEntries: 10,
          header: 'h2',
          sampleTs: 0,
          sampleLevel: '',
          sampleService: '',
          sampleMsg: '',
          stackTraceEntries: 1,
          sampleStackTraceMsg: '',
        },
      }),
    ]);

    expect(merged.considered).toBe(17);
    expect(merged.traceActivityCases).toBe(9);
    expect(merged.traceStats.total).toBe(15);
    expect(merged.traceStats.pruned).toBe(4);
    expect(merged.semanticStats.totalServices).toBe(42);
    expect(merged.semanticStats.semanticallyResolved).toBe(28);
    expect(merged.semanticStats.embeddingResolved).toBe(21);
    expect(merged.semanticStats.llmResolved).toBe(7);
    expect(merged.semanticStats.exactMatched).toBe(14);
    expect(merged.logStats.total).toBe(12);
    expect(merged.logStats.errorEntries).toBe(50);
    expect(merged.logStats.stackTraceEntries).toBe(7);
  });

  it('re-derives the edge means from their counts instead of averaging the slices', () => {
    // 12 cases at 20 edges and 5 at 10 is 290/17 = 17.0588…; the block mean is 15. The two differ whenever the
    // slices are uneven, so an implementation that averaged would pass a same-size fixture and fail on real cells.
    const merged = mergeLoadStats([
      stats({
        considered: 12,
        traceStats: { total: 0, pruned: 0, avgEdgesBefore: 20, avgEdgesAfter: 18, header: '' },
      }),
      stats({
        considered: 5,
        traceStats: { total: 0, pruned: 0, avgEdgesBefore: 10, avgEdgesAfter: 8, header: '' },
      }),
    ]);

    expect(merged.traceStats.avgEdgesBefore).toBeCloseTo(290 / 17, 12);
    expect(merged.traceStats.avgEdgesBefore).not.toBeCloseTo(15, 6);
    expect(merged.traceStats.avgEdgesAfter).toBeCloseTo(256 / 17, 12);
  });

  it('takes each SAMPLE from the first slice that has one', () => {
    // A sample is a sample of the corpus, so any slice's answer is the cell's; picking the first non-empty one is
    // what keeps the printed line identical to the one a single pass would have printed.
    const merged = mergeLoadStats([
      stats(),
      stats({
        traceStats: {
          total: 1,
          pruned: 0,
          avgEdgesBefore: 1,
          avgEdgesAfter: 1,
          header: 'trace-hdr',
        },
        logStats: {
          total: 1,
          errorEntries: 1,
          header: 'log-hdr',
          sampleTs: 1705595460000,
          sampleLevel: 'ERROR',
          sampleService: 'carts',
          sampleMsg: 'boom',
          stackTraceEntries: 1,
          sampleStackTraceMsg: 'at carts.CartService',
        },
      }),
      stats({
        traceStats: { total: 1, pruned: 0, avgEdgesBefore: 1, avgEdgesAfter: 1, header: 'later' },
        logStats: {
          total: 1,
          errorEntries: 1,
          header: 'later-log',
          sampleTs: 9,
          sampleLevel: 'FATAL',
          sampleService: 'other',
          sampleMsg: 'later',
          stackTraceEntries: 0,
          sampleStackTraceMsg: 'later-st',
        },
      }),
    ]);

    expect(merged.traceStats.header).toBe('trace-hdr');
    expect(merged.logStats.header).toBe('log-hdr');
    expect(merged.logStats.sampleTs).toBe(1705595460000);
    expect(merged.logStats.sampleLevel).toBe('ERROR');
    expect(merged.logStats.sampleService).toBe('carts');
    expect(merged.logStats.sampleMsg).toBe('boom');
    expect(merged.logStats.sampleStackTraceMsg).toBe('at carts.CartService');
  });

  it('recomputes each census from its ROWS rather than folding its summaries', () => {
    const a = stats({
      latencyRouteByCaseId: new Map([['c1', latency(4)]]),
      logRouteEntries: [logRoute('logicHttp', 3)],
      anchorProvenances: ['declared'],
    });
    const b = stats({
      latencyRouteByCaseId: new Map([['c2', latency(6)]]),
      logRouteEntries: [logRoute('logicHttp', 0)],
      anchorProvenances: ['rescaled'],
    });

    const merged = mergeLoadStats([a, b]);

    expect(merged.logRoutes).toEqual(
      summarizeLogRoutes([...a.logRouteEntries, ...b.logRouteEntries]),
    );
    expect(merged.anchors).toEqual(summarizeInjectionAnchors(['declared', 'rescaled']));
    expect(merged.latencyRoutes).toEqual(
      summarizeLatencyRoutes([
        ...(a.latencyRouteByCaseId?.values() ?? []),
        ...(b.latencyRouteByCaseId?.values() ?? []),
      ]),
    );
    expect([...merged.latencyRouteByCaseId.keys()]).toEqual(['c1', 'c2']);
  });

  it('unions the exception names, so a name two slices saw appears once', () => {
    // The names are carried as a LIST and rendered where they are shown, which is what makes the fold a union.
    // Concatenating two RENDERINGS instead would repeat every shared name, and splitting the result back apart would
    // be a parse of a string this file wrote.
    const merged = mergeLoadStats([
      stats({ exceptionNames: ['TimeoutException', 'MongoSocketException'] }),
      stats({ exceptionNames: ['MongoSocketException', 'EOFException'] }),
    ]);

    expect(merged.exceptionNames).toEqual([
      'TimeoutException',
      'MongoSocketException',
      'EOFException',
    ]);
  });

  it('keeps the corpus order of the names it unions', () => {
    // The rendering shows the FIRST twelve, so the fold's order is what decides which twelve a reader sees. Slice
    // order is corpus order, and the set of one slice cannot be reordered by the fold.
    const merged = mergeLoadStats([
      stats({ exceptionNames: ['A', 'B'] }),
      stats({ exceptionNames: ['C'] }),
      stats({ exceptionNames: ['D', 'A'] }),
    ]);

    expect(merged.exceptionNames).toEqual(['A', 'B', 'C', 'D']);
  });

  it('adds error samples per message, and keeps the messages apart', () => {
    const a = stats({ errorSamples: new Map([['missing metrics.json', 2]]) });
    const b = stats({
      errorSamples: new Map([
        ['missing metrics.json', 1],
        ['bad csv', 4],
      ]),
    });

    const merged = mergeLoadStats([a, b]);

    expect([...merged.errorSamples.entries()].sort()).toEqual([
      ['bad csv', 4],
      ['missing metrics.json', 3],
    ]);
    expect(merged.errors).toEqual([]);
  });

  it('reports NO cases, because releasing them is what the slicing is for', () => {
    // The one field a fold cannot restore, stated here so a caller reads it rather than discovers it: every
    // remaining use of a merged result is an aggregate, and the paths that used to read `cases` read a digest.
    const merged = mergeLoadStats([stats({ considered: 3 }), stats({ considered: 4 })]);

    expect(merged.cases).toEqual([]);
    expect(merged.considered).toBe(7);
  });

  it('is the identity on a single slice', () => {
    const only = coherent({
      considered: 4,
      traceStats: { total: 2, pruned: 1, avgEdgesBefore: 7, avgEdgesAfter: 6, header: 'h' },
      logRouteEntries: [logRoute('logicHttp', 2)],
      anchorProvenances: ['centred'],
      exceptionNames: ['X'],
    });

    const merged = mergeLoadStats([only]);

    expect(merged.considered).toBe(only.considered);
    expect(merged.traceStats).toEqual(only.traceStats);
    expect(merged.logRoutes).toEqual(only.logRoutes);
    expect(merged.anchors).toEqual(only.anchors);
    expect(merged.exceptionNames).toEqual(only.exceptionNames);
  });

  it('divides by zero cases without producing NaN', () => {
    // A cell where every case failed to load reaches this fold with `considered === 0`, and `0/0` in the edge means
    // would print `NaN` in a diagnostic line rather than a number.
    const merged = mergeLoadStats([stats(), stats()]);

    expect(merged.traceStats.avgEdgesBefore).toBe(0);
    expect(merged.traceStats.avgEdgesAfter).toBe(0);
    expect(Number.isNaN(merged.traceStats.avgEdgesBefore)).toBe(false);
  });
});
