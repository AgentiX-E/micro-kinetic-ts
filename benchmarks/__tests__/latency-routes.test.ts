/**
 * The latency channel's three routes, and the verdict their counts earn.
 *
 * ## The question this instrument answers
 *
 * The register's sharpest open item, left by iteration 73: on RE3 OnlineBoutique the census read
 * `failedEdges 15/30` and `latency 0/30` — from ONE file, in the SAME cases. Two mechanisms predict that
 * zero and they differ in everything a decision would need:
 *
 * - the cap truncates the span list before the post-injection window (`tryLoadTraces` reads a byte prefix, and
 *   `countTraceActivityByService`'s docblock says so in as many words) ⇒ no edge has an AFTER-side mean;
 * - the assembly scales a start time that is already in milliseconds by 1000 a second time ⇒ every span lands
 *   after the anchor ⇒ no edge has a BEFORE-side mean.
 *
 * `input-coverage` can only say that `latency` holds nothing. This module counts the cap's sides and each
 * route's rows, so the artifact names the mechanism instead of the symptom — and the first test below is the
 * defect as an executable assertion, because that is the only form of it that cannot rot.
 *
 * @module benchmarks/__tests__/latency-routes
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  formatLatencyRoutes,
  latencyChannelVerdict,
  summarizeLatencyRoutes,
  type LatencyRouteCensus,
  type LatencyRouteEntry,
} from '../src/directional-evidence.js';
import {
  applyLatencyView,
  countCapSides,
  DEFAULT_LATENCY_SOURCE,
  deriveLatencyViews,
  selectLatencyView,
} from '../src/rcaeval-corpus.js';

import type {
  BenchmarkCase,
  BenchmarkTraceSpan,
} from '../../packages/kinetic/src/benchmarks/loaders/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, '..', rel), 'utf8');

/** An anchor with the magnitude of a real Unix millisecond stamp. */
const ANCHOR_MS = 1_700_000_000_000;

/**
 * One parent and two children, one per side of the anchor — an edge with a comparable pair, and nothing else.
 *
 * The start times are MILLISECONDS, which is what `normalizeTraceStartTime` returns and what
 * `BenchmarkTraceSpan.startTime` declares. A test that built them in seconds would exercise the very
 * confusion the defect is made of.
 */
const span = (
  spanId: string,
  service: string,
  startTime: number,
  extra: { parentSpanId?: string; status?: 'OK' | 'ERROR' } = {},
): BenchmarkTraceSpan => ({
  traceId: 't1',
  spanId,
  ...(extra.parentSpanId === undefined ? {} : { parentSpanId: extra.parentSpanId }),
  service,
  operationName: 'op',
  startTime,
  duration: 10,
  status: extra.status ?? 'OK',
});

/** The caller and its two callees: `a>b` with a before-mean and an after-mean. */
const TRACES: readonly BenchmarkTraceSpan[] = [
  span('p1', 'a', ANCHOR_MS - 3000),
  span('c1', 'b', ANCHOR_MS - 1000, { parentSpanId: 'p1' }),
  span('c2', 'b', ANCHOR_MS + 1000, { parentSpanId: 'p1' }),
];

/** A census built field by field, so a test states only the numbers its arm is about. */
const census = (over: Partial<LatencyRouteCensus> = {}): LatencyRouteCensus => ({
  cases: 1,
  casesWithoutAnchor: 0,
  casesWithCapSpans: 1,
  capSpans: 3,
  capPre: 2,
  capPost: 1,
  casesCapAllAfter: 0,
  casesCapAllBefore: 0,
  casesCapComparable: 1,
  shippedCases: 0,
  shippedRows: 0,
  cappedCases: 0,
  cappedRows: 0,
  wholeFileCases: 0,
  wholeFileRows: 0,
  ...over,
});

/** A passed-through whole-file view, so the third route is a value the test controls. */
const WHOLE_FILE = [{ caller: 'a', callee: 'b', preMeanMs: 10, postMeanMs: 200 }];

/** The three views, as the owner would hand them back. */
const VIEWS = {
  shipped: [] as readonly never[],
  capped: [{ caller: 'a', callee: 'b', preMeanMs: 10, postMeanMs: 10 }],
  'whole-file': WHOLE_FILE,
} as unknown as Parameters<typeof selectLatencyView>[1];

describe('the three routes to `edgeLatency`', () => {
  it('shows the shipped view going empty while the capped view does not — the defect, executable', () => {
    // THE assertion of this iteration. One trace list, one anchor, two views only one of which can hold a
    // pair: the published composition scales an already-millisecond value by 1000, so every span is "after"
    // the anchor and `toEngineDirectionalInputs` returns `[]` — the same array on every case of every suite,
    // which is why nine cells read `latency 0` and no corpus could explain it.
    const { views, capSides } = deriveLatencyViews(TRACES, ANCHOR_MS, WHOLE_FILE);
    expect(views.shipped, 'the shipped view is empty BY CONSTRUCTION, not by starvation').toEqual(
      [],
    );
    expect(views.capped, 'the same list with the value scaled once holds the pair').toHaveLength(1);
    expect(views.capped[0]).toEqual({
      caller: 'a',
      callee: 'b',
      preMeanMs: 10,
      postMeanMs: 10,
    });
    // The cap's own split, which is the OTHER mechanism's signature: two spans before the anchor, one after,
    // so a cap that truncated before the window would read `pre: 3, post: 0` — a different number, and now a
    // visible one.
    expect(capSides).toEqual({ spans: 3, pre: 2, post: 1 });
    // The whole-file view is passed through untouched: it comes from the streaming pass this assembly already
    // pays for, and re-deriving it here would be a second implementation of it.
    expect(views['whole-file']).toEqual(WHOLE_FILE);
  });

  it('counts the cap sides, and is total over an empty list', () => {
    expect(countCapSides([], ANCHOR_MS)).toEqual({ spans: 0, pre: 0, post: 0 });
    // All-after and all-before are the two signatures the verdict block reads; both are reached here so the
    // arms below are about a shape the counter can actually produce.
    expect(countCapSides([{ startTime: ANCHOR_MS }], ANCHOR_MS)).toEqual({
      spans: 1,
      pre: 0,
      post: 1,
    });
    expect(countCapSides([{ startTime: ANCHOR_MS - 1 }], ANCHOR_MS)).toEqual({
      spans: 1,
      pre: 1,
      post: 0,
    });
  });

  it('selects a view without touching anything else about the case', () => {
    const benchCase = {
      id: 'c1',
      failedTraceEdges: [{ caller: 'a', callee: 'b', failed: 3, baseline: 1 }],
      edgeLatency: [],
      groundTruth: { serviceId: 'b', faultType: 'CPU' },
    } as unknown as BenchmarkCase;
    const selected = selectLatencyView(benchCase, VIEWS, 'whole-file');
    expect(selected.edgeLatency).toEqual(WHOLE_FILE);
    // Everything else is the same object graph, and the input is untouched — one assembly serves every row.
    expect(selected.groundTruth).toBe(benchCase.groundTruth);
    expect(benchCase.edgeLatency).toEqual([]);
    expect(selected).not.toBe(benchCase);

    // The population-level form. An id with no views is returned UNCHANGED rather than dropped: a case the
    // caller did not assemble is not a case this function may silently remove from a run.
    const known = { id: 'c1' } as unknown as BenchmarkCase;
    const orphan = { id: 'nope' } as unknown as BenchmarkCase;
    const applied = applyLatencyView([known, orphan], new Map([['c1', VIEWS]]), 'capped');
    expect(applied[0]!.edgeLatency).toEqual(VIEWS.capped);
    expect(applied[1]).toBe(orphan);
    // The published corpus's view is the one whose array is empty, so the default is not a cosmetic choice.
    expect(DEFAULT_LATENCY_SOURCE).toBe('shipped');
  });
});

describe('the latency-route census', () => {
  const entry = (over: Partial<LatencyRouteEntry> = {}): LatencyRouteEntry => ({
    anchorPresent: true,
    capSpans: 0,
    capPre: 0,
    capPost: 0,
    shippedRows: 0,
    cappedRows: 0,
    wholeFileRows: 0,
    ...over,
  });

  it('aggregates every count, and counts a case by the side its cap landed on', () => {
    const c = summarizeLatencyRoutes([
      // One case with a comparable pair and rows on two routes.
      entry({ capSpans: 10, capPre: 4, capPost: 6, cappedRows: 2, wholeFileRows: 3 }),
      // One all-after, one all-before, one with no spans at all.
      entry({ capSpans: 5, capPre: 0, capPost: 5, wholeFileRows: 1 }),
      entry({ capSpans: 5, capPre: 5, capPost: 0, shippedRows: 7 }),
      // …and one with no usable anchor, which has to be counted on its own or it impersonates ALL-AFTER.
      entry({ anchorPresent: false, capSpans: 4, capPre: 0, capPost: 4 }),
    ]);
    expect(c).toMatchObject({
      cases: 4,
      casesWithoutAnchor: 1,
      casesWithCapSpans: 4,
      capSpans: 24,
      capPre: 9,
      capPost: 15,
      casesCapAllAfter: 2,
      casesCapAllBefore: 1,
      casesCapComparable: 1,
      cappedCases: 1,
      cappedRows: 2,
      shippedCases: 1,
      shippedRows: 7,
      wholeFileCases: 2,
      wholeFileRows: 4,
    });
    // A case with no spans contributes its zeros and is counted in the population — which is what makes
    // `N/M` in the verdict a rate rather than a count of the cases that had anything to say.
    expect(summarizeLatencyRoutes([]).cases).toBe(0);
  });

  it('names the mechanism, and appends the whole-file discriminator only when it can decide', () => {
    // The published cells: the shipped view emitted nothing, every capped span is at/after the anchor, and the
    // streaming route DID produce rows. That is the shape of RE3 OnlineBoutique and it names a defect rather
    // than a starvation.
    const allAfter = census({
      casesCapAllAfter: 30,
      casesCapAllBefore: 0,
      casesCapComparable: 0,
      capPre: 0,
      capPost: 300,
      wholeFileCases: 27,
      wholeFileRows: 412,
    });
    expect(latencyChannelVerdict(allAfter)).toContain('ALL-AFTER');
    expect(latencyChannelVerdict(allAfter)).toContain('30/30');
    expect(latencyChannelVerdict(allAfter)).toContain('the channel is not starved');
    expect(latencyChannelVerdict(allAfter)).toContain('412 rows in 27/30 cases');

    // The confound, and it is asserted to OUTRANK the arm above it: a case with no usable anchor produces the
    // same all-after signature without any start time being scaled wrongly, so `inject_time.txt` being absent
    // would otherwise be reported as a unit defect the run does not have. Its rate is over the POPULATION —
    // `cases` — because a missing anchor is a property of the case, not of a case that had spans to split.
    const noAnchor = census({
      cases: 30,
      casesWithoutAnchor: 30,
      casesCapAllAfter: 30,
      casesCapComparable: 0,
      wholeFileRows: 412,
    });
    expect(latencyChannelVerdict(noAnchor)).toContain('NO ANCHOR');
    expect(latencyChannelVerdict(noAnchor)).toContain('30/30 cases carry no usable injection time');
    expect(latencyChannelVerdict(noAnchor)).not.toContain('ALL-AFTER');
    // And with ONE anchor present the whole population is not accused of missing it — the count is a count.
    expect(
      latencyChannelVerdict(census({ cases: 30, casesWithoutAnchor: 1, casesCapAllAfter: 29 })),
    ).toContain('1/30 cases carry no usable injection time');

    // The cap's signature: the other side empty. Different cause, and the string says which side.
    const allBefore = census({
      casesCapAllAfter: 0,
      casesCapAllBefore: 30,
      casesCapComparable: 0,
      capPre: 300,
      capPost: 0,
      wholeFileCases: 27,
      wholeFileRows: 412,
    });
    expect(latencyChannelVerdict(allBefore)).toContain('CAP TRUNCATES');
    expect(latencyChannelVerdict(allBefore)).toContain('BEFORE the anchor');

    // A view that produced a row is not explained away: the shipped arm outranks every starvation, because a
    // zero elsewhere cannot unmake a measurement.
    expect(latencyChannelVerdict(census({ shippedCases: 2, shippedRows: 5 }))).toContain(
      'LIVE (shipped) — 5 rows in 2 cases',
    );
    expect(latencyChannelVerdict(census({ cappedCases: 3, cappedRows: 9 }))).toContain(
      'LIVE (capped) — 9 rows in 3 cases',
    );

    // No spans at all is the one case where the corpus really is the answer.
    expect(latencyChannelVerdict(census({ capSpans: 0, casesWithCapSpans: 0 }))).toContain(
      'STARVED',
    );
    // Comparable pairs and no rows: the derivation is the only suspect left, and the fallthrough says so.
    // This arm is a RESIDUE rather than a catch-all — every arm above it has been excluded, so `capSpans > 0`
    // with no case all-after and none all-before can only mean every case holds both sides.
    expect(latencyChannelVerdict(census())).toContain('UNEXPLAINED');
    expect(latencyChannelVerdict(census())).toContain('1 cases hold both sides');
    // The discriminator is APPENDED, so a dead channel that the whole-file route can still read says both.
    expect(
      latencyChannelVerdict(
        census({ capSpans: 0, casesWithCapSpans: 0, wholeFileRows: 1, wholeFileCases: 1 }),
      ),
    ).toContain('STARVED');
    // …and it is not appended to a live reading, which is already the strongest statement available.
    expect(
      latencyChannelVerdict(census({ shippedCases: 1, shippedRows: 1, wholeFileRows: 9 })),
    ).not.toContain('its input is discarded');
  });

  it('renders the counts and the verdict as the two lines the artifact carries', () => {
    const lines = formatLatencyRoutes(
      census({ capSpans: 20, capPre: 9, capPost: 11, wholeFileCases: 27, wholeFileRows: 412 }),
      'OnlineBoutique',
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('latency-routes[OnlineBoutique]: 1 cases');
    expect(lines[0]).toContain('no anchor 0');
    expect(lines[0]).toContain('capped spans 20 (pre 9 / post 11)');
    expect(lines[0]).toContain('rows: shipped 0 | capped 0 | whole-file 412');
    expect(lines[1]).toContain('VERDICT:');
  });
});

describe('the corpus owns the views, and the unit contract is fenced', () => {
  it('derives all three views in ONE assembly, and keeps the published one as a recorded value', () => {
    const owner = read('src/rcaeval-corpus.ts');
    // The shipped view IS the historical expression, kept verbatim: a repair that changed it in place would
    // move a published number without an artifact that says it moved.
    expect(owner).toMatch(/startTime: s\.startTime \* 1000/);
    // The capped view passes the loader's own normalised value through — no second scale.
    expect(owner).toMatch(/capped: toEngineDirectionalInputs\(spans, injectTimeMs\)\.edgeLatency/);
    // The whole-file view is the streaming pass's own array, not a re-derivation.
    expect(owner).toMatch(/'whole-file': wholeFile/);
    expect(owner).toMatch(/streaming\.edgeLatency/);
    // The selection is the owner's, so a runner cannot index the views itself.
    expect(owner).toContain('export function selectLatencyView(');
    expect(owner).toContain('export function applyLatencyView(');
  });

  it('states the view at every call site, so which corpus a run ranked on is never an omission', () => {
    // The `prismPooling` law one level up: an option a caller can name and a call site omits is an open axis.
    // The golden's line is the one that matters most, because it is what the nine cells ARE.
    for (const runner of ['src/run-rcaeval.ts', 'src/run-optimize.ts', 'src/run-ablation.ts']) {
      expect(read(runner), `${runner} must state its corpus's latency view`).toMatch(
        /latencyFrom: (?:'shipped'|DEFAULT_LATENCY_SOURCE)/,
      );
    }
  });

  it('prints the census and the corpus line, so no row ranks on an inferred corpus', () => {
    const battery = read('src/run-ablation.ts');
    expect(battery).toContain('formatLatencyRoutes(bundle.latencyRoutes, systemName)');
    expect(battery).toContain('console.log(`Corpus: edgeLatency from ${latencyView}`);');
    // The three corpus rows, as QUOTED literals — a bare `toContain('LAT WHOLE FILE')` would be satisfied by
    // the control row, which is a superstring of it.
    for (const label of [
      'LAT WHOLE FILE (corpus edgeLatency=whole-file)',
      'LAT CAPPED (corpus edgeLatency=capped)',
      'LAT WHOLE FILE + LAT OFF',
    ]) {
      expect(battery, `${label} must be a row, as a label literal`).toContain(`label: '${label}'`);
    }
    // The two corpus rows that are NOT the control vary no engine knob at all, so a difference between them
    // and the baseline can only be the corpus.
    expect(battery).toMatch(
      /latencyView: 'whole-file',\s*\n\s*label: 'LAT WHOLE FILE \(corpus edgeLatency=whole-file\)'/,
    );
    // The control carries BOTH the corpus change and `latWeight = 0`, which is what makes it a control.
    expect(battery).toMatch(
      /overrides: \{ latWeight: 0 \},\s*\n\s*latencyView: 'whole-file',\s*\n\s*label: 'LAT WHOLE FILE \+ LAT OFF'/,
    );
  });
});
